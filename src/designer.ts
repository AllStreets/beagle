// The designer: an agent that designs agents. It reads how the last generation did (race scores
// only, never race items) and how its best agents failed on a small sample of breeding items,
// and writes the next generation: changed instructions, rewired workflows, other models, more or
// fewer worked examples, crossings of two parents. Every child carries its parents and a reason.
import { randomUUID } from 'node:crypto';
import { open, json } from './store.ts';
import * as ledger from './ledger.ts';
import { complete, LimitError } from './models/index.ts';
import { run, RunError } from './runner.ts';
import { getArena, dataOf, hooks, gradeSafely } from './arenas/index.ts';
import { getVoyage, summarize, examplesFor, passing } from './race.ts';
import { validate, type Genome } from './genome.ts';

export const DESIGNER = 'claude:claude-opus-5-5';
export type Bred = { next: Genome[]; parents: Record<string, string[]>; reasons: Record<string, string>; refused: { name: string; why: string }[]; usd: number };

const SCHEMA = {
  type: 'object', required: ['children'],
  properties: { children: { type: 'array', items: { type: 'object', required: ['name', 'parents', 'model', 'instructions', 'tools', 'workflow', 'memory', 'reason'], properties: {
    name: { type: 'string', description: 'a short plain name a person can tell apart, like the existing ones' },
    parents: { type: 'array', items: { type: 'string' }, description: 'ids of the one or two agents it comes from' },
    model: { type: 'string' }, instructions: { type: 'string' },
    tools: { type: 'array', items: { type: 'string' } },
    workflow: { type: 'object', required: ['shape'], properties: { shape: { enum: ['single', 'plan-then-answer', 'self-check', 'vote'] }, n: { type: 'integer' } } },
    memory: { type: 'object', required: ['examples'], properties: { examples: { type: 'integer' } } },
    reason: { type: 'string', description: 'one or two sentences: what in the evidence led to this change' },
  } } } },
};

const system = (toolNames: string[]) => `You design agents for a task, the way a breeder selects and crosses. You are given how the last generation scored and where its best agents went wrong on practice items. Design the next generation.
Each child changes one or two things from its parent, or crosses two parents, and the reason must point at evidence you were given. Keep a spread: some children cheap and fast (local ollama models), some aimed at the top score. Prefer changes that fix the failures you can see over rewording for its own sake.
Allowed models: claude:claude-haiku-4-5, claude:claude-sonnet-5, ollama:qwen3:1.7b, ollama:llama3.1:8b, ollama:qwen2.5-coder:7b. Allowed tools: ${toolNames.length ? toolNames.join(', ') : 'none in this arena'}. Workflow shapes: single, plan-then-answer, self-check, vote (with n from 2 to 7). Worked examples: 0 to 8.`;

// wait out usage limits and passing faults, counting anything paid before a fault
async function patient<T>(f: () => Promise<T>, paid: (usd: number) => void): Promise<T> {
  const backoff = Number(process.env.BEAGLE_BACKOFF_MS ?? 30_000);
  for (let attempt = 0; ; attempt++) {
    try { return await f(); }
    catch (thrown) {
      const err = thrown instanceof RunError ? thrown.cause : thrown; if (thrown instanceof RunError && thrown.spent) paid(thrown.spent);
      if (attempt >= 5 || !(err instanceof LimitError || passing(err))) throw err;
      await new Promise(r => setTimeout(r, backoff * 2 ** attempt));
    }
  }
}

export async function breed(voyageId: string, generation: number, o: { children: number; elites: number; probe: number; log?: (s: string) => void }): Promise<Bred> {
  const v = getVoyage(voyageId), arena = getArena(v.arena), db = open(), log = o.log ?? (() => {}), next = generation + 1;
  if (v.settings.localOnly) throw new Error('this voyage uses only models on this Mac, and the designer is a Claude model; breed by hand or turn that setting off');
  const rows = db.prepare('select genome, task, score, status, usd, ms from runs where voyage = ? and generation = ?').all(v.id, generation) as { genome: string; task: string; score: number; status: string; usd: number; ms: number }[];
  const { scores } = summarize(rows, v.settings.seed);
  const bodies = new Map((db.prepare('select id, body from genomes where voyage = ? and generation = ?').all(v.id, generation) as { id: string; body: string }[]).map(g => [g.id, json<Genome>(g.body, null as unknown as Genome)]));
  const ranked = scores.filter(s => bodies.has(s.genome));
  const elites = ranked.slice(0, o.elites).map(s => bodies.get(s.genome)!);
  let usd = 0;

  // the probe: the best agents answer a few breeding items; their misses are the evidence
  const probeItems = (db.prepare(`select id, input, truth from tasks where arena = ? and split = 'breeding' order by id limit ?`).all(dataOf(v.arena), o.probe) as { id: string; input: string; truth: string }[]);
  const examples = examplesFor(v.id);
  const evidence: string[] = [];
  for (const s of ranked.slice(0, 4)) {
    const g = bodies.get(s.genome)!;
    for (const t of probeItems) {
      const input = json(t.input, null), truth = json<unknown>(t.truth, null);
      const r = await patient(() => run(g, { id: t.id, input }, arena, { examples }), paid => { usd += paid; ledger.add({ voyage: v.id, generation: next, kind: 'design', model: g.model, usd: paid, ms: 0 }); });
      usd += r.usd; ledger.add({ voyage: v.id, generation: next, kind: 'design', model: g.model, usd: r.usd, ms: r.ms });
      const score = r.status === 'done' ? await gradeSafely(arena, r.answer, truth) : 0;
      if (score >= 1) continue;
      const said = r.trace.filter(x => x.kind === 'model').map(x => String(x.output)).join(' / ').slice(0, 500);
      evidence.push(`[${g.id}] item: ${arena.show(input).slice(0, 1500)}\n  ${r.status === 'done' ? hooks(arena).miss(r.answer, truth) : 'it gave no answer'}; score ${Math.round(score * 100)}; what it said: ${said}`);
    }
  }
  log(`  probe: ${evidence.length} misses on ${probeItems.length} breeding items`);

  const table = ranked.map(s => `${s.genome} "${bodies.get(s.genome)!.name}": score ${Math.round(s.mean * 100)} (range ${Math.round(s.lo * 100)} to ${Math.round(s.hi * 100)}), $${s.usd.toFixed(3)}, ${(s.ms / 1000).toFixed(1)} s per item, ${s.noAnswer} unanswered\n  design: ${JSON.stringify({ model: bodies.get(s.genome)!.model, tools: bodies.get(s.genome)!.tools, workflow: bodies.get(s.genome)!.workflow, memory: bodies.get(s.genome)!.memory })}\n  told: ${bodies.get(s.genome)!.instructions}`).join('\n');
  const controls = scores.filter(s => s.genome.startsWith('baseline:')).map(s => `${s.genome.slice(9)}: ${Math.round(s.mean * 100)}`).join(', ');
  const prompt = `The task: ${arena.describe}\n\nGeneration ${generation + 1}, best first, on the race items (you do not see those items):\n${table}\n\nControls on the same items: ${controls}\n\nWhere the best agents went wrong on practice items:\n${evidence.join('\n') || '(no misses)'}\n\nNow design the next generation: ${o.children} children.`;
  const r = await patient(() => complete(DESIGNER, [{ role: 'system', content: system(arena.tools.map(t => t.name)) }, { role: 'user', content: prompt }], { schema: SCHEMA, timeoutMs: 600_000 }), () => {});
  usd += r.usd; ledger.add({ voyage: v.id, generation: next, kind: 'design', model: DESIGNER, usd: r.usd, ms: r.ms });

  const out: Bred = { next: [...elites], parents: {}, reasons: {}, refused: [], usd };
  for (const e of elites) { out.parents[e.id] = [e.id]; out.reasons[e.id] = `Kept unchanged: one of the ${o.elites} best of generation ${generation + 1}.`; }
  const kids = ((r.json as { children?: any[] } | undefined)?.children ?? []);
  for (const c of kids) {
    try {
      const parents = (c.parents ?? []).filter((p: string) => bodies.has(p));
      if (!parents.length) throw new Error(`no known parent among ${JSON.stringify(c.parents)}`);
      const g = validate({ id: `g${next}-${randomUUID().slice(0, 6)}`, name: c.name, model: c.model, instructions: c.instructions, tools: c.tools, workflow: c.workflow, memory: c.memory });
      out.next.push(g); out.parents[g.id] = parents; out.reasons[g.id] = String(c.reason ?? '');
    } catch (e) { out.refused.push({ name: String(c.name), why: (e as Error).message }); }
  }
  const put = db.prepare('insert or replace into genomes (id, voyage, generation, parent_ids, body, reason) values (?, ?, ?, ?, ?, ?)');
  for (const g of out.next) put.run(g.id, v.id, next, JSON.stringify(out.parents[g.id]), JSON.stringify(g), out.reasons[g.id]);
  log(`  designed ${out.next.length - elites.length} children, kept ${elites.length}, refused ${out.refused.length}; $${usd.toFixed(2)}`);
  return out;
}
