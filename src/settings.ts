import { open, json } from './store.ts';

// What a person can change in Settings. Every voyage takes a copy when it starts, so changing
// Settings later never rewrites what a past voyage did.
export type Settings = {
  capGeneration: number;     // dollars of Claude Code's reported cost per generation
  capVoyage: number;         // and per voyage
  concurrency: number;       // runs at once
  raceTasks: number;         // tasks each genome races on
  population: number;        // genomes per generation
  generations: number;
  seed: number;              // fixes task samples, examples and intervals
  localOnly: boolean;        // never call Claude
  localAgents: boolean;      // agents run only on this Mac; the designer may still be Claude
  view: 'plain' | 'lab';
  reducedMotion: boolean;
};

export const DEFAULTS: Settings = { capGeneration: 5, capVoyage: 25, concurrency: 4, raceTasks: 100, population: 12, generations: 5, seed: 1, localOnly: false, localAgents: false, view: 'plain', reducedMotion: false };

export function getSettings(): Settings {
  const rows = open().prepare('select key, value from settings').all() as { key: string; value: string }[];
  return { ...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, json(r.value, null)]).filter(([, v]) => v !== null)) };
}

// Only known keys of the right type are kept; anything else is refused with a reason.
export function saveSettings(patch: Partial<Settings>): Settings {
  const db = open(), put = db.prepare('insert or replace into settings (key, value) values (?, ?)');
  for (const [k, v] of Object.entries(patch)) {
    const d = (DEFAULTS as Record<string, unknown>)[k];
    if (d === undefined) throw new Error(`unknown setting "${k}"`);
    if (typeof v !== typeof d) throw new Error(`setting "${k}" must be a ${typeof d}`);
    if (typeof v === 'number' && (!isFinite(v) || v < 0)) throw new Error(`setting "${k}" must be zero or more`);
    if (k === 'view' && !['plain', 'lab'].includes(v as string)) throw new Error('view must be plain or lab');
    put.run(k, JSON.stringify(v));
  }
  return getSettings();
}
