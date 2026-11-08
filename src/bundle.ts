// A voyage as one file anyone can check: the genomes, every task raced with its truth, every
// answer, the arena's and the sealed test's fingerprints, the settings and seed. Re-grading a
// bundle recomputes every score from the answers alone, with no model calls.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { open, json } from './store.ts';
import { paths } from './paths.ts';
import { getArena } from './arenas/index.ts';
import { getVoyage, summarize, type RaceResult } from './race.ts';

export type Bundle = {
  format: 'beagle-bundle-1';
  voyage: { id: string; arena: string; started_at: string; sealed_hash: string; settings: unknown; status: string };
  arena: { id: string; hash: string; version: string };
  genomes: { id: string; generation: number; body: unknown; reason: string | null }[];
  tasks: Record<string, { input: unknown; truth: unknown }>;
  runs: { generation: number; genome: string; task: string; answer: unknown; score: number; status: string; usd: number; ms: number }[];
};

export function exportBundle(voyageId: string): string {
  const v = getVoyage(voyageId), db = open();
  const a = db.prepare('select hash, version from arenas where id = ?').get(v.arena) as { hash: string; version: string } | undefined;
  const runs = db.prepare('select generation, genome, task, answer, score, status, usd, ms from runs where voyage = ? order by generation, genome, task').all(v.id) as { generation: number; genome: string; task: string; answer: string; score: number; status: string; usd: number; ms: number }[];
  const taskIds = [...new Set(runs.map(r => r.task))];
  const tasks = Object.fromEntries((taskIds.length ? db.prepare(`select id, input, truth from tasks where id in (${taskIds.map(() => '?').join(',')})`).all(...taskIds) as { id: string; input: string; truth: string }[] : []).map(t => [t.id, { input: json(t.input, null), truth: json(t.truth, null) }]));
  const b: Bundle = {
    format: 'beagle-bundle-1',
    voyage: { id: v.id, arena: v.arena, started_at: v.started_at, sealed_hash: v.sealed_hash, settings: v.settings, status: v.status },
    arena: { id: v.arena, hash: a?.hash ?? 'not recorded', version: a?.version ?? 'not recorded' },
    genomes: (db.prepare('select id, generation, body, reason from genomes where voyage = ?').all(v.id) as { id: string; generation: number; body: string; reason: string | null }[]).map(g => ({ ...g, body: json(g.body, null) })),
    tasks,
    runs: runs.map(r => ({ ...r, answer: json(r.answer, null) })),
  };
  mkdirSync(paths.bundles, { recursive: true });
  const file = join(paths.bundles, `${v.id}.beagle.json`);
  writeFileSync(file, JSON.stringify(b, null, 1));
  return file;
}

// Re-score every answer with the arena's grader and summarise one generation (the last, unless
// named). `mismatches` counts answers whose recorded score differs from the recomputed one.
export function regrade(file: string, generation?: number): RaceResult & { generation: number; mismatches: number } {
  const b = JSON.parse(readFileSync(file, 'utf8')) as Bundle;
  if (b.format !== 'beagle-bundle-1') throw new Error('not a Beagle bundle');
  const arena = getArena(b.voyage.arena);
  const gen = generation ?? Math.max(...b.runs.map(r => r.generation).filter(g => g >= 0));
  let mismatches = 0;
  const rows = b.runs.filter(r => r.generation === gen).map(r => {
    const score = r.status === 'done' ? arena.grade(r.answer, b.tasks[r.task]?.truth) : 0;
    if (Math.abs(score - r.score) > 1e-9) mismatches++;
    return { ...r, score };
  });
  const seed = (b.voyage.settings as { seed?: number }).seed ?? 1;
  return { complete: true, generation: gen, mismatches, ...summarize(rows, seed) };
}
