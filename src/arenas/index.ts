import type { Arena } from './types.ts';
import { geotag, geotagNamed } from './geotag/index.ts';

const ARENAS: Record<string, Arena> = { geotag, 'geotag-named': geotagNamed };

export function getArena(id: string): Arena {
  const a = ARENAS[id]; if (!a) throw new Error(`no arena "${id}"`);
  return a;
}
export function registerArena(a: Arena) { ARENAS[a.id] = a; }
export const arenaIds = () => Object.keys(ARENAS);

// whose tasks an arena uses
export const dataOf = (id: string) => getArena(id).data;

// what an arena does when it says nothing: an answer is any object, a vote keeps the answer most
// agents gave, and examples and misses are shown as they are
const same = (x: unknown) => JSON.stringify(x);
export function hooks(a: Arena) {
  return {
    valid: a.valid ?? ((x: unknown) => x !== null && typeof x === 'object'),
    merge: a.merge ?? ((xs: unknown[]) => { const n = new Map<string, number>(); for (const x of xs) n.set(same(x), (n.get(same(x)) ?? 0) + 1); let best: unknown = xs[0] ?? null, top = 0; for (const x of xs) { const c = n.get(same(x))!; if (c > top) { top = c; best = x; } } return best; }),
    example: a.example ?? ((t: unknown) => same(t)),
    miss: a.miss ?? ((x: unknown, t: unknown) => `answered ${same(x).slice(0, 300)}; the truth was ${same(t).slice(0, 300)}`),
    maxTurns: a.maxTurns ?? 6,
  };
}

// a grade never stops a race: a grader that throws, or runs past its time, scores the run 0
export async function gradeSafely(a: Arena, answer: unknown, truth: unknown): Promise<number> {
  try {
    const ms = a.graderTimeoutMs ?? 120_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // the timer holds the process open, so a grader that never returns cannot end a race silently
    const s = await Promise.race([Promise.resolve().then(() => a.grade(answer, truth)), new Promise<number>((_, no) => { timer = setTimeout(() => no(new Error('the grader ran out of time')), ms); })]).finally(() => clearTimeout(timer));
    return typeof s === 'number' && isFinite(s) ? Math.max(0, Math.min(1, s)) : 0;
  } catch { return 0; }
}

// generation one's agents: the arena's own, or for geotagging, its hand-written starters
import { starters as geoStarters } from './geotag/starters.ts';
export const startersFor = (id: string) => getArena(id).starters?.() ?? (getArena(id).data === 'geotag' ? geoStarters() : []);
export function unregisterArena(id: string) { delete ARENAS[id]; }
