// Fossils: a winning agent's skill pressed into a small network that runs on this Mac.
// The teacher (an agent) answers unlabelled pool items; each item is turned into numbers by a
// local embedding model; MLX trains a network to say which cell of the globe the teacher would
// answer in. The fossil is then judged on the race items, against the truth and its teacher.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, json } from './store.ts';
import { paths } from './paths.ts';
import * as ledger from './ledger.ts';
import { run, RunError } from './runner.ts';
import { getArena, dataOf } from './arenas/index.ts';
import { getVoyage, raceTasks, examplesFor, passing } from './race.ts';
import { km, asPoint, grade, type Truth } from './arenas/geotag/grade.ts';
import { LimitError } from './models/index.ts';
import type { Genome } from './genome.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PY = join(ROOT, 'trainer', '.venv', 'bin', 'python'), TRAIN = join(ROOT, 'trainer', 'train.py');
const OLLAMA = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434', EMBED = 'nomic-embed-text';
type P = { lat: number; lon: number };

// Group answers into 1-degree cells; a cell needs `min` answers to stand, and the rest fold into
// the nearest standing cell. Each cell is centred on the mean of its answers.
export function makeCells(pts: P[], min = 3): { centres: P[]; of: number[] } {
  const key = (p: P) => `${Math.floor(p.lat)},${Math.floor(p.lon)}`;
  const groups = new Map<string, number[]>(); pts.forEach((p, i) => groups.set(key(p), [...(groups.get(key(p)) ?? []), i]));
  const standing = [...groups.values()].filter(g => g.length >= min);
  const centre = (ids: number[]) => ({ lat: ids.reduce((n, i) => n + pts[i].lat, 0) / ids.length, lon: ids.reduce((n, i) => n + pts[i].lon, 0) / ids.length });
  let centres = standing.map(centre);
  const of = pts.map(p => { let best = 0, bd = Infinity; centres.forEach((c, j) => { const d = km(p, c); if (d < bd) { bd = d; best = j; } }); return best; });
  // re-centre each cell on everything that ended up in it
  centres = centres.map((c, j) => { const ids = of.flatMap((o, i) => o === j ? [i] : []); return ids.length ? centre(ids) : c; });
  return { centres, of };
}

export function judgeFossil(o: { predicted: P[]; truth: Truth[]; teacherScores: (number | null)[] }) {
  // only items the teacher actually ran: an item it never ran says nothing about it
  const keep = o.teacherScores.map((t, i) => t === null ? -1 : i).filter(i => i >= 0);
  o = { predicted: keep.map(i => o.predicted[i]), truth: keep.map(i => o.truth[i]), teacherScores: keep.map(i => o.teacherScores[i]) };
  const scores = o.predicted.map((p, i) => grade(p, o.truth[i]));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const score = mean(scores), teacher = mean(o.teacherScores as number[]);
  const agreement = mean(scores.map((s, i) => Math.abs(s - (o.teacherScores[i] as number)) < .1 ? 1 : 0));
  return { score, teacher, agreement, scores, items: scores.length, standsIn: score >= teacher - .05 };
}

async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const r = await fetch(`${OLLAMA}/api/embed`, { method: 'POST', body: JSON.stringify({ model: EMBED, input: texts.slice(i, i + 64).map(t => `classification: ${t}`) }) });
    if (!r.ok) throw new Error(`embedding failed: ${r.status}`);
    out.push(...((await r.json()) as { embeddings: number[][] }).embeddings);
  }
  return out;
}
const py = (args: string[]) => new Promise<string>((ok, fail) => { const p = spawn(PY, [TRAIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }); let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d); p.on('close', c => c === 0 ? ok(o.trim().split('\n').at(-1)!) : fail(new Error(`trainer: ${e.slice(-400)}`))); });

// 1. the teacher answers pool items (resumable: answered items are kept)
export async function teach(voyageId: string, genomeId: string, o: { limit: number; capUsd: number; concurrency?: number; log?: (s: string) => void }) {
  const v = getVoyage(voyageId), db = open(), arena = getArena(v.arena), log = o.log ?? (() => {});
  db.exec(`create table if not exists teachings (voyage text, genome text, task text, answer text, primary key (voyage, genome, task))`);
  const g = json<Genome>((db.prepare('select body from genomes where voyage = ? and id = ?').get(v.id, genomeId) as { body: string } | undefined)?.body, null as unknown as Genome);
  if (!g) throw new Error(`no genome ${genomeId} in ${v.id}`);
  const pool = db.prepare(`select id, input from tasks where arena = ? and split = 'pool' and id not in (select task from teachings where voyage = ? and genome = ?) order by id limit ?`).all(dataOf(v.arena), v.id, genomeId, o.limit) as { id: string; input: string }[];
  const put = db.prepare('insert or replace into teachings (voyage, genome, task, answer) values (?, ?, ?, ?)');
  const examples = examplesFor(v.id); let spent = 0, done = 0, next = 0;
  // each worker retries its own item; the teaching cap and the voyage's cap both hold
  const worker = async () => {
    while (next < pool.length && spent < o.capUsd && ledger.spent(v.id) < v.settings.capVoyage) {
      const t = pool[next++];
      for (let attempt = 0; attempt < 5; attempt++) {
        try { const r = await run(g, { id: t.id, input: json(t.input, null) }, arena, { examples }); spent += r.usd; ledger.add({ voyage: v.id, generation: null, kind: 'teach', model: g.model, usd: r.usd, ms: r.ms }); if (asPoint(r.answer)) put.run(v.id, genomeId, t.id, JSON.stringify(r.answer)); break; }
        catch (e) { const paid = e instanceof RunError ? e.spent : 0; if (paid) { spent += paid; ledger.add({ voyage: v.id, generation: null, kind: 'teach', model: g.model, usd: paid, ms: 0 }); } const c = e instanceof RunError ? e.cause : e; if (!(c instanceof LimitError || passing(c))) break; await new Promise(r => setTimeout(r, 30_000 * 2 ** attempt)); }
      }
      if (++done % 100 === 0) log(`  taught ${done} of ${pool.length}, $${spent.toFixed(2)}`);
    }
  };
  await Promise.all(Array.from({ length: o.concurrency ?? 4 }, worker));
  return { taught: (db.prepare('select count(*) n from teachings where voyage = ? and genome = ?').get(v.id, genomeId) as { n: number }).n, spent };
}

// 2 and 3. embed, train, and judge on the race items; the fossil and its report are stored
export async function fossilise(voyageId: string, genomeId: string, o: { epochs?: number; withBreeding?: boolean; log?: (s: string) => void } = {}) {
  const v = getVoyage(voyageId), db = open(), arena = getArena(v.arena), log = o.log ?? (() => {});
  if (!existsSync(PY)) throw new Error('the training environment is not set up: see trainer/README');
  const rows = db.prepare(`select t.input, te.answer from teachings te join tasks t on t.id = te.task where te.voyage = ? and te.genome = ?`).all(v.id, genomeId) as { input: string; answer: string }[];
  if (rows.length < 200) throw new Error(`only ${rows.length} taught items; teach at least 200 first`);
  // the teacher's answers; and, if asked, the breeding items with their true places as well
  const breeding = o.withBreeding ? (db.prepare(`select input, truth from tasks where arena = ? and split = 'breeding'`).all(dataOf(v.arena)) as { input: string; truth: string }[]) : [];
  const texts = [...rows, ...breeding].map(r => arena.show(json(r.input, null)).split('\n').slice(1).join(' '));
  const answers = [...rows.map(r => JSON.parse(r.answer) as P), ...breeding.map(b => { const p = json<Truth>(b.truth, { places: [] }).places[0]; return { lat: p.lat, lon: p.lon }; })];
  const cells = makeCells(answers, 3);
  log(`  ${rows.length} taught items${breeding.length ? ` and ${breeding.length} breeding items` : ''} in ${cells.centres.length} cells; embedding on this Mac...`);
  const X = await embed(texts);
  const dir = join(paths.home, 'fossils', `${v.id}-${genomeId}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'dataset.json'), JSON.stringify({ x: X, y: cells.of, n_cells: cells.centres.length }));
  log('  training with MLX...');
  await py([join(dir, 'dataset.json'), dir, '--epochs', String(o.epochs ?? 40)]);
  // the full report, with the training curve, is on disk; the printed one leaves the curve out
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  // judge on the race items: the fossil's answer is its cell's centre
  const race = raceTasks(v), raceX = await embed(race.map(t => arena.show(json(t.input, null)).split('\n').slice(1).join(' ')));
  writeFileSync(join(dir, 'race.json'), JSON.stringify({ x: raceX }));
  const pred = JSON.parse(await py(['predict', join(dir, 'fossil.safetensors'), String(X[0].length), String(cells.centres.length), join(dir, 'race.json')]));
  const teacherScores = race.map(t => (db.prepare('select score from runs where voyage = ? and genome = ? and task = ? order by generation desc limit 1').get(v.id, genomeId, t.id) as { score: number } | undefined)?.score ?? null);
  const judged = judgeFossil({ predicted: pred.cells.map((c: number) => cells.centres[c]), truth: race.map(t => json<Truth>(t.truth, { places: [] })), teacherScores });
  const embedMs = await (async () => { const t0 = Date.now(); await embed([texts[0]]); return Date.now() - t0; })();
  const t = db.prepare('select avg(usd) usd, avg(ms) ms from runs where voyage = ? and genome = ?').get(v.id, genomeId) as { usd: number; ms: number };
  const name = json<{ name?: string }>((db.prepare('select body from genomes where voyage = ? and id = ? limit 1').get(v.id, genomeId) as { body: string } | undefined)?.body ?? '{}', {}).name ?? genomeId;
  const record = { voyage: v.id, genome: genomeId, name, teacher_ms: t.ms ?? 0, teacher_usd: t.usd ?? 0, at: new Date().toISOString(), taught: rows.length, breeding: breeding.length, items: texts.length, cells: cells.centres.length, ...report, embed_ms: embedMs, race: { score: judged.score, teacher: judged.teacher, agreement: judged.agreement, standsIn: judged.standsIn, items: judged.items } };
  writeFileSync(join(dir, 'fossil.json'), JSON.stringify({ ...record, centres: cells.centres }, null, 1));
  db.exec(`create table if not exists fossils (voyage text, genome text, at text, record text, primary key (voyage, genome))`);
  db.prepare('insert or replace into fossils (voyage, genome, at, record) values (?, ?, ?, ?)').run(v.id, genomeId, record.at, JSON.stringify(record));
  return record;
}
