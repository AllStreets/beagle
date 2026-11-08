import type { Arena } from './types.ts';
import { geotag, geotagNamed } from './geotag/index.ts';

const ARENAS: Record<string, Arena> = { geotag, 'geotag-named': geotagNamed };

export function getArena(id: string): Arena {
  const a = ARENAS[id]; if (!a) throw new Error(`no arena "${id}"`);
  return a;
}

// whose tasks an arena uses
export const dataOf = (id: string) => getArena(id).data;
