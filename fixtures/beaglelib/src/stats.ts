// The numbers behind every claim: a seeded bootstrap for 95% intervals, and Pareto ranks over
// accuracy, cost and time. Seeded so the same runs always give the same intervals.

// mulberry32: a small, well-known seeded generator
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

// 95% percentile bootstrap over 10,000 resamples
export function bootstrap(xs: number[], seed: number): { lo: number; hi: number } {
  if (!xs.length) return { lo: 0, hi: 0 };
  const r = rng(seed), n = xs.length, means = new Float64Array(10_000);
  for (let b = 0; b < means.length; b++) { let s = 0; for (let i = 0; i < n; i++) s += xs[Math.floor(r() * n)]; means[b] = s / n; }
  means.sort();
  return { lo: means[Math.floor(.025 * means.length)], hi: means[Math.ceil(.975 * means.length) - 1] };
}

// Rank 1 is the front: no one beats it on accuracy without costing more or taking longer.
export function pareto(items: { mean: number; usd: number; ms: number }[]): number[] {
  const beats = (a: typeof items[0], b: typeof items[0]) => a.mean >= b.mean && a.usd <= b.usd && a.ms <= b.ms && (a.mean > b.mean || a.usd < b.usd || a.ms < b.ms);
  const rank = items.map(() => 0); let left = items.map((_, i) => i), r = 1;
  while (left.length) {
    const front = left.filter(i => !left.some(j => j !== i && beats(items[j], items[i])));
    for (const i of front) rank[i] = r;
    left = left.filter(i => !front.includes(i)); r++;
  }
  return rank;
}
