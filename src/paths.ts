import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// Everything Beagle keeps lives in one folder. BEAGLE_HOME moves it (the tests use a temporary one).
// It is read on every use, so a program that imports Beagle can point it at its own folder first.
export const home = () => process.env.BEAGLE_HOME || join(homedir(), 'Library', 'Application Support', 'Beagle');

export const paths = {
  get home() { return home(); },
  get db() { return join(home(), 'beagle.db'); },
  get arenas() { return join(home(), 'arenas'); },     // built arena data, such as the gazetteer
  get cache() { return join(home(), 'cache'); },       // every fetched page and file, so builds can resume
  get bundles() { return join(home(), 'bundles'); },   // exported voyages anyone can re-grade
};

export function ensureDirs() {
  for (const p of Object.values(paths)) if (!p.endsWith('.db')) mkdirSync(p, { recursive: true });
}
