// Runs one genome on one task. Beagle drives the loop itself: each model turn replies in JSON
// with either a tool request or an answer; Beagle runs the tool and feeds the result back. The
// same loop drives Claude and local models, so every trace and cost is Beagle's own record.
import { complete, type Turn } from './models/index.ts';
import type { Arena } from './arenas/types.ts';
import type { Genome } from './genome.ts';
import { km, asPoint } from './arenas/geotag/grade.ts';

export type Step = { kind: 'model' | 'tool' | 'note'; input: unknown; output: unknown; usd: number; ms: number };
export type RunResult = { answer: unknown | null; trace: Step[]; usd: number; ms: number; status: 'done' | 'no-answer' };
export type Example = { input: unknown; truth: unknown };

const MAX_TURNS = 6, MAX_MALFORMED = 2;

function system(g: Genome, arena: Arena, examples: Example[]): string {
  const tools = arena.tools.filter(t => g.tools.includes(t.name));
  const parts = [
    arena.describe, '', g.instructions, '',
    'Reply with JSON only.',
    tools.length
      ? `To use a tool, reply {"action": "<tool name>", "args": {...}}. To answer, reply {"action": "answer", "answer": ${JSON.stringify(arena.answer)}}.\nTools:\n${tools.map(t => `- ${t.name}: ${t.describe} Arguments: ${JSON.stringify(t.args)}`).join('\n')}`
      : `Reply {"action": "answer", "answer": ${JSON.stringify(arena.answer)}}.`,
  ];
  if (examples.length) {
    parts.push('', 'Worked examples, with the true answer:');
    for (const e of examples) {
      const t = e.truth as { places?: { name: string; lat: number; lon: number }[] };
      const p = t.places?.[0];
      parts.push(`Item: ${arena.show(e.input)}\nAnswer: ${p ? JSON.stringify({ lat: p.lat, lon: p.lon }) + ` (${p.name})` : JSON.stringify(e.truth)}`);
    }
  }
  return parts.join('\n');
}

const turnSchema = (g: Genome, arena: Arena) => ({
  type: 'object', required: ['action'],
  properties: { action: { enum: [...g.tools, 'answer'] }, args: { type: 'object' }, answer: arena.answer },
});

// One loop of turns until an answer, a run of malformed replies, or the turn limit.
async function loop(g: Genome, arena: Arena, turns: Turn[], trace: Step[]): Promise<unknown | null> {
  let malformed = 0, used = 0;
  while (used < MAX_TURNS) {
    used++;
    const r = await complete(g.model, turns, { schema: turnSchema(g, arena) });
    const reply = r.json as { action?: string; args?: unknown; answer?: unknown } | undefined;
    trace.push({ kind: 'model', input: turns.at(-1)!.content, output: r.text, usd: r.usd, ms: r.ms });
    turns.push({ role: 'assistant', content: r.text });
    if (reply?.action === 'answer' && reply.answer && typeof reply.answer === 'object') return reply.answer;
    const tool = reply?.action ? arena.tools.find(t => t.name === reply.action) : undefined;
    if (tool && g.tools.includes(tool.name)) {
      const t0 = Date.now(); let out: unknown;
      try { out = await tool.run(reply!.args ?? {}); } catch (e) { out = { error: (e as Error).message }; }
      trace.push({ kind: 'tool', input: { name: tool.name, args: reply!.args }, output: out, usd: 0, ms: Date.now() - t0 });
      turns.push({ role: 'user', content: `Result of ${tool.name}: ${JSON.stringify(out)}` });
      continue;
    }
    if (reply?.action && reply.action !== 'answer') { turns.push({ role: 'user', content: `The tool "${reply.action}" is not available to you. Answer with {"action": "answer", ...}.` }); continue; }
    if (++malformed >= MAX_MALFORMED) break;
    turns.push({ role: 'user', content: 'That reply was not in the required JSON shape. Reply with JSON only, as described.' });
  }
  return null;
}

// Of several answers, the one with the least total distance to the others (a medoid), so an
// outlier never wins against answers that agree.
function middle(answers: unknown[]): unknown | null {
  const pts = answers.map(asPoint).filter((p): p is { lat: number; lon: number } => !!p);
  if (!pts.length) return answers.find(a => a !== null) ?? null;
  let best = pts[0], bestSum = Infinity;
  for (const p of pts) { const s = pts.reduce((n, q) => n + km(p, q), 0); if (s < bestSum) { best = p; bestSum = s; } }
  return best;
}

export async function run(g: Genome, task: { id: string; input: unknown }, arena: Arena, o: { examples?: Example[] } = {}): Promise<RunResult> {
  const trace: Step[] = [];
  const sys: Turn = { role: 'system', content: system(g, arena, (o.examples ?? []).slice(0, g.memory.examples || (o.examples?.length ?? 0))) };
  const ask = (): Turn[] => [sys, { role: 'user', content: arena.show(task.input) }];
  let answer: unknown | null = null;
  const shape = g.workflow.shape;
  if (shape === 'vote') {
    const all: unknown[] = [];
    for (let i = 0; i < (g.workflow.n ?? 3); i++) all.push(await loop(g, arena, ask(), trace));
    answer = middle(all.filter(a => a !== null));
  } else if (shape === 'plan-then-answer') {
    const turns = ask(); turns[1] = { role: 'user', content: `${turns[1].content}\n\nFirst, before acting, reply {"plan": "..."} with a short plan.` };
    const r = await complete(g.model, turns, { schema: { type: 'object', required: ['plan'], properties: { plan: { type: 'string' } } } });
    trace.push({ kind: 'model', input: turns.at(-1)!.content, output: r.text, usd: r.usd, ms: r.ms });
    const plan = (r.json as { plan?: string } | undefined)?.plan ?? r.text;
    answer = await loop(g, arena, [sys, { role: 'user', content: `${arena.show(task.input)}\n\nYour plan: ${plan}\nNow carry it out.` }], trace);
  } else {
    const turns = ask();
    answer = await loop(g, arena, turns, trace);
    if (shape === 'self-check' && answer !== null) {
      turns.push({ role: 'user', content: `You answered ${JSON.stringify(answer)}. Check it: is that really where this happened, and the most specific place named? Reply with your final answer.` });
      answer = (await loop(g, arena, turns, trace)) ?? answer;
    }
  }
  if (answer === null) trace.push({ kind: 'note', input: null, output: 'no answer: the agent never gave an answer in the required shape', usd: 0, ms: 0 });
  return { answer, trace, usd: trace.reduce((n, s) => n + s.usd, 0), ms: trace.reduce((n, s) => n + s.ms, 0), status: answer === null ? 'no-answer' : 'done' };
}
