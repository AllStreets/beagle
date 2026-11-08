import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// Everything Beagle keeps lives in one folder. BEAGLE_HOME moves it (the tests use a temporary one).
export const HOME = process.env.BEAGLE_HOME ?? join(homedir(), 'Library', 'Application Support', 'Beagle');

export const paths = {
  home: HOME,
  db: join(HOME, 'beagle.db'),
  arenas: join(HOME, 'arenas'),     // built arena data, such as the gazetteer
  cache: join(HOME, 'cache'),       // every fetched page and file, so builds can resume
  bundles: join(HOME, 'bundles'),   // exported voyages anyone can re-grade
};

export function ensureDirs() {
  for (const p of Object.values(paths)) if (!p.endsWith('.db')) mkdirSync(p, { recursive: true });
}
