// Every model call is written down: what it cost and how long it took. Claude calls carry
// Claude Code's reported cost; local calls are free but their time still counts.
import { open } from './store.ts';

export type Entry = { voyage: string | null; generation?: number | null; kind: 'race' | 'design' | 'baseline' | 'teach'; model: string; usd: number; ms: number };

export function add(e: Entry) {
  open().prepare('insert into ledger (at, voyage, generation, kind, model, usd, ms) values (?, ?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), e.voyage, e.generation ?? null, e.kind, e.model, e.model.startsWith('ollama:') ? 0 : e.usd, Math.round(e.ms));
}

export function spent(voyage: string, since?: string): number {
  const r = open().prepare('select coalesce(sum(usd), 0) usd from ledger where voyage = ? and at >= ?').get(voyage, since ?? '') as { usd: number };
  return r.usd;
}

export function time(voyage: string): number {
  return (open().prepare('select coalesce(sum(ms), 0) ms from ledger where voyage = ?').get(voyage) as { ms: number }).ms;
}

// what one generation of a voyage has paid, discarded runs included
export function spentOnGeneration(voyage: string, generation: number): number {
  return (open().prepare('select coalesce(sum(usd), 0) usd from ledger where voyage = ? and generation = ?').get(voyage, generation) as { usd: number }).usd;
}
