// Voyages and races. A voyage fixes its arena, settings and the sealed test's fingerprint
// before anything runs. A race runs every genome (and the baselines) on the same sample of race
// tasks, under the spend caps, waiting out usage limits, and resuming where it stopped.
import { createHash, randomUUID } from 'node:crypto';
import { open, json } from './store.ts';
import * as ledger from './ledger.ts';
import { LimitError } from './models/index.ts';
import { run, type Example, type Step } from './runner.ts';
import { getArena, dataOf } from './arenas/index.ts';
import { baselines } from './baselines.ts';
import { getSettings, type Settings } from './settings.ts';
import { bootstrap, mean, pareto } from './stats.ts';
import type { Genome } from './genome.ts';

export type Voyage = { id: string; arena: string; started_at: string; sealed_hash: string; settings: Settings; status: string };
export type Score = { genome: string; mean: number; lo: number; hi: number; usd: number; ms: number; pareto: number; tasks: number; noAnswer: number; within: number };   // within: full marks, on the same tasks as the score
export type RaceResult = { complete: boolean; reason?: string; common: string[]; scores: Score[] };
export type RaceEvent =
  | { type: 'run'; generation: number; genome: string; task: string; score: number; status: string; usd: number; ms: number }
  | { type: 'progress'; generation: number; done: number; total: number; spent: number }
  | { type: 'waiting'; until: string; reason: string }
  | { type: 'stopped'; generation: number; reason: string }
  | { type: 'finished'; generation: number; result: RaceResult };

type TaskRow = { id: string; input: string; truth: string | null };
const order = (seed: number, salt: string) => (a: { id: string }, b: { id: string }) =>
  createHash('sha1').update(`${seed}${salt}${a.id}`).digest('hex').localeCompare(createHash('sha1').update(`${seed}${salt}${b.id}`).digest('hex'));

// The sealed test's fingerprint: every sealed task's id, text and truth, in a fixed order.
export function sealedHash(arena: string): string {
  const rows = open().prepare(`select id, input, truth from tasks where arena = ? and split = 'sealed' order by id`).all(dataOf(arena)) as TaskRow[];
  return createHash('sha256').update(rows.map(r => `${r.id}|${r.input}|${r.truth}`).join('\n')).digest('hex');
}

export function startVoyage(arena: string, o: Partial<Settings> = {}): Voyage {
  getArena(arena);
  const v: Voyage = { id: `v-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`, arena, started_at: new Date().toISOString(), sealed_hash: sealedHash(arena), settings: { ...getSettings(), ...o }, status: 'racing' };
  open().prepare('insert into voyages (id, arena, started_at, sealed_hash, settings, status) values (?, ?, ?, ?, ?, ?)').run(v.id, v.arena, v.started_at, v.sealed_hash, JSON.stringify(v.settings), v.status);
  return v;
}

export function getVoyage(id: string): Voyage {
  const r = open().prepare('select * from voyages where id = ?').get(id) as (Omit<Voyage, 'settings'> & { settings: string }) | undefined;
  if (!r) throw new Error(`no voyage "${id}"`);
  return { ...r, settings: json(r.settings, getSettings()) };
}

const sample = (v: Voyage, split: string, n: number, salt: string) =>
  (open().prepare(`select id, input, truth from tasks where arena = ? and split = ?`).all(dataOf(v.arena), split) as TaskRow[]).sort(order(v.settings.seed, salt)).slice(0, n);

export const raceTasks = (v: Voyage) => sample(v, 'race', v.settings.raceTasks, 'race');
// Worked examples: from the breeding split only, the same for every genome in the voyage
export const examplesFor = (voyageId: string): Example[] => sample(getVoyage(voyageId), 'breeding', 8, 'examples').map(t => ({ input: json(t.input, null), truth: json(t.truth, null) }));

// The same summary for a live race and a re-grade: each genome scored only on the tasks every
// genome finished, with a seeded 95% interval and a Pareto rank over accuracy, cost and time.
export function summarize(rows: { genome: string; task: string; score: number; status: string; usd: number; ms: number }[], seed: number): { common: string[]; scores: Score[] } {
  const genomes = [...new Set(rows.map(r => r.genome))];
  const byGenome = new Map(genomes.map(g => [g, new Map(rows.filter(r => r.genome === g).map(r => [r.task, r]))]));
  const common = [...new Set(rows.map(r => r.task))].filter(t => genomes.every(g => byGenome.get(g)!.has(t))).sort();
  const raw = genomes.map(g => {
    const rs = common.map(t => byGenome.get(g)!.get(t)!);
    const xs = rs.map(r => r.score), ci = bootstrap(xs, seed);
    return { genome: g, mean: mean(xs), lo: ci.lo, hi: ci.hi, usd: rs.reduce((n, r) => n + r.usd, 0), ms: Math.round(mean(rs.map(r => r.ms))), tasks: rs.length, noAnswer: rs.filter(r => r.status === 'no-answer').length, within: rs.filter(r => r.score >= 1).length, pareto: 0 };
  });
  const ranks = pareto(raw);
  raw.forEach((s, i) => s.pareto = ranks[i]);
  return { common, scores: raw.sort((a, b) => b.mean - a.mean || a.usd - b.usd) };
}

type Entrant = { id: string; model: string; baseline: boolean; exec(t: { id: string; input: unknown }): Promise<{ answer: unknown | null; trace: Step[]; usd: number; ms: number; status: 'done' | 'no-answer' }> };

export async function race(voyageId: string, generation: number, genomes: Genome[], o: { baselines?: boolean; tasks?: TaskRow[]; onEvent?: (e: RaceEvent) => void } = {}): Promise<RaceResult> {
  const v = getVoyage(voyageId), s = v.settings, arena = getArena(v.arena), db = open();
  const emit = o.onEvent ?? (() => {});
  const tasks = o.tasks ?? raceTasks(v);
  const examples = examplesFor(v.id);
  const putGenome = db.prepare('insert or ignore into genomes (id, voyage, generation, parent_ids, body, reason) values (?, ?, ?, ?, ?, ?)');
  for (const g of genomes) putGenome.run(g.id, v.id, generation, '[]', JSON.stringify(g), null);

  const entrants: Entrant[] = [
    ...genomes.filter(g => !(s.localOnly && g.model.startsWith('claude:'))).map(g => ({ id: g.id, model: g.model, baseline: false, exec: (t: { id: string; input: unknown }) => run(g, t, arena, { examples }) })),
    ...(o.baselines === false ? [] : baselines(v.arena).filter(b => !(s.localOnly && b.model.startsWith('claude:'))).map(b => ({
      id: `baseline:${b.name}`, model: b.model, baseline: true,
      exec: async (t: { id: string; input: unknown }) => { const r = await b.answer(t); return { answer: r.answer, trace: [{ kind: 'note' as const, input: null, output: r.note, usd: r.usd, ms: r.ms }], usd: r.usd, ms: r.ms, status: (r.answer === null ? 'no-answer' : 'done') as 'done' | 'no-answer' }; },
    }))),
  ];
  const has = db.prepare('select 1 from runs where voyage = ? and generation = ? and genome = ? and task = ?');
  // task by task, so if the cap stops the race, every genome has done the same tasks
  const jobs = tasks.flatMap(t => entrants.map(e => ({ t, e }))).filter(j => !has.get(v.id, generation, j.e.id, j.t.id));
  const total = tasks.length * entrants.length;
  const genSpent = () => (db.prepare('select coalesce(sum(usd), 0) n from runs where voyage = ? and generation = ?').get(v.id, generation) as { n: number }).n;
  const putRun = db.prepare('insert or ignore into runs (id, voyage, generation, genome, task, answer, score, trace, usd, ms, status, at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const backoff = Number(process.env.BEAGLE_BACKOFF_MS ?? 30_000);
  let stop: string | null = null, done = total - jobs.length, next = 0;

  async function worker() {
    while (!stop && next < jobs.length) {
      if (genSpent() >= s.capGeneration) { stop = `the generation reached its $${s.capGeneration} cap`; break; }
      if (ledger.spent(v.id) >= s.capVoyage) { stop = `the voyage reached its $${s.capVoyage} cap`; break; }
      const { t, e } = jobs[next++];
      const task = { id: t.id, input: json(t.input, null) };
      let result: Awaited<ReturnType<Entrant['exec']>> | null = null;
      for (let attempt = 0; attempt < 6 && !result; attempt++) {
        try { result = await e.exec(task); }
        catch (err) {
          if (!(err instanceof LimitError)) { result = { answer: null, trace: [{ kind: 'note', input: null, output: `error: ${(err as Error).message}`, usd: 0, ms: 0 }], usd: 0, ms: 0, status: 'no-answer' }; break; }
          const wait = backoff * 2 ** attempt;
          emit({ type: 'waiting', until: new Date(Date.now() + wait).toISOString(), reason: err.message });
          await new Promise(r => setTimeout(r, wait));
        }
      }
      if (!result) { stop = 'Claude usage limit; resume the race later'; break; }
      const score = result.status === 'done' ? arena.grade(result.answer, json(t.truth, null)) : 0;
      putRun.run(randomUUID(), v.id, generation, e.id, t.id, JSON.stringify(result.answer), score, JSON.stringify(result.trace), result.usd, result.ms, result.status, new Date().toISOString());
      ledger.add({ voyage: v.id, kind: e.baseline ? 'baseline' : 'race', model: e.model, usd: result.usd, ms: result.ms });
      done++;
      emit({ type: 'run', generation, genome: e.id, task: t.id, score, status: result.status, usd: result.usd, ms: result.ms });
      emit({ type: 'progress', generation, done, total, spent: ledger.spent(v.id) });
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, s.concurrency) }, worker));
  const ids = new Set(entrants.map(e => e.id)), taskIds = new Set(tasks.map(t => t.id));
  const rows = (db.prepare('select genome, task, score, status, usd, ms from runs where voyage = ? and generation = ?').all(v.id, generation) as { genome: string; task: string; score: number; status: string; usd: number; ms: number }[]).filter(r => ids.has(r.genome) && taskIds.has(r.task));
  const result: RaceResult = { complete: !stop && done >= total, ...(stop ? { reason: stop } : {}), ...summarize(rows, s.seed) };
  emit(stop ? { type: 'stopped', generation, reason: stop } : { type: 'finished', generation, result });
  return result;
}

export function finishVoyage(id: string) { open().prepare(`update voyages set status = 'finished' where id = ?`).run(id); }

// The sealed test is only ever run once the voyage is over, and stored as generation -1.
export async function sealedScore(voyageId: string, genomeIds: string[], o: { onEvent?: (e: RaceEvent) => void } = {}): Promise<RaceResult> {
  const v = getVoyage(voyageId);
  if (v.status !== 'finished') throw new Error(`voyage ${v.id} is not finished; the sealed test stays sealed until it is`);
  if (sealedHash(v.arena) !== v.sealed_hash) throw new Error('the sealed test has changed since the voyage began');
  const rows = open().prepare(`select body from genomes where voyage = ? and id in (${genomeIds.map(() => '?').join(',')})`).all(v.id, ...genomeIds) as { body: string }[];
  const sealed = open().prepare(`select id, input, truth from tasks where arena = ? and split = 'sealed'`).all(dataOf(v.arena)) as TaskRow[];
  return race(v.id, -1, rows.map(r => JSON.parse(r.body) as Genome), { baselines: true, tasks: sealed, onEvent: o.onEvent });
}
