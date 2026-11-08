import type { Arena } from './types.ts';
import { geotag } from './geotag/index.ts';

const ARENAS: Record<string, Arena> = { geotag };

export function getArena(id: string): Arena {
  const a = ARENAS[id]; if (!a) throw new Error(`no arena "${id}"`);
  return a;
}
