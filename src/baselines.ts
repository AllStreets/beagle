// Baselines: what an evolved agent has to beat for its score to mean anything. They race on the
// same tasks as the genomes and are stored as runs under genome ids "baseline:<name>".
import { complete } from './models/index.ts';
import { lookup } from './arenas/geotag/gazetteer.ts';
import { rng } from './stats.ts';
import { createHash } from 'node:crypto';
import { getArena } from './arenas/index.ts';

export type BaselineName = 'random point' | 'gazetteer alone' | 'one Claude call';
export type Baseline = { name: BaselineName; model: string; answer(task: { id: string; input: unknown }): Promise<{ answer: unknown | null; usd: number; ms: number; note: string }> };

const seedOf = (s: string) => createHash('sha1').update(s).digest().readUInt32LE(0);

// Controls see each task exactly as the agents in the same arena do: with the places hidden
// in the hidden arena, named in the named one.
export function baselines(arenaId: string): Baseline[] {
  const arena = getArena(arenaId);
  if (arena.data !== 'geotag') return [];
  const shown = (input: unknown) => arena.show(input);
  return [
    {
      // a point drawn evenly over the whole globe, fixed by the task, so it is reproducible
      name: 'random point', model: 'none',
      async answer(t) {
        const r = rng(seedOf(t.id));
        return { answer: { lat: Math.asin(2 * r() - 1) * 180 / Math.PI, lon: r() * 360 - 180 }, usd: 0, ms: 0, note: 'a random point on the globe' };
      },
    },
    {
      // no model at all: the first capitalised name in the text that the gazetteer knows
      name: 'gazetteer alone', model: 'none',
      async answer(t) {
        const t0 = Date.now(), text = shown(t.input);
        const names = [...text.matchAll(/\b[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)*/gu)].map(m => m[0]).filter(n => !/^(A|An|The|At|In|On|After|Before|During|President|Prime|Minister)$/.test(n));
        for (const n of names) { const p = lookup(n)[0]; if (p) return { answer: { lat: p.lat, lon: p.lon }, usd: 0, ms: Date.now() - t0, note: `first known name: ${n} (${p.name}, ${p.country})` }; }
        return { answer: null, usd: 0, ms: Date.now() - t0, note: 'no name in the text is in the gazetteer' };
      },
    },
    {
      // the least effort with a model: one plain question to Haiku, no instructions, no tools
      name: 'one Claude call', model: 'claude:claude-haiku-4-5',
      async answer(t) {
        const r = await complete('claude:claude-haiku-4-5', [
          { role: 'system', content: 'Reply with JSON only: {"action": "answer", "answer": {"lat": <number>, "lon": <number>}}.' },
          { role: 'user', content: `Where did this happen? ${shown(t.input)}` },
        ], { schema: { type: 'object', required: ['action', 'answer'], properties: { action: { enum: ['answer'] }, answer: { type: 'object', required: ['lat', 'lon'], properties: { lat: { type: 'number' }, lon: { type: 'number' } } } } } });
        const answer = (r.json as { answer?: unknown } | undefined)?.answer ?? null;
        // the reply itself is kept, so a missing answer can be checked
        return { answer, usd: r.usd, ms: r.ms, note: `one call to Haiku, no instructions or tools. It replied: ${r.text.slice(0, 600)}` };
      },
    },
  ];
}
