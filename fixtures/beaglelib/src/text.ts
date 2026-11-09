// Small text helpers: amounts and times in words, a round number for a scale bar, and a diff of
// two texts by sentence.
export const money = (x: number) => `$${x.toFixed(x < 1 ? 3 : 2)}`;
export const secs = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
export const dist = (d: number | null) => d === null ? 'no answer' : d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d).toLocaleString('en-GB')} km`;

// 1, 2 or 5 times a power of ten, the nearest to x
export const nice = (x: number) => { const p = 10 ** Math.floor(Math.log10(x)), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };

const sentences = (s: string) => s.split(/(?<=[.?!:])\s+/).filter(Boolean);
// the longest common run of sentences, the rest marked as struck out or written in
export function sentenceDiff(a: string, b: string): { t: 'same' | 'del' | 'ins'; w: string }[] {
  const A = sentences(a), B = sentences(b), n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: { t: 'same' | 'del' | 'ins'; w: string }[] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push({ t: 'same', w: A[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: 'del', w: A[i++] }); else out.push({ t: 'ins', w: B[j++] }); }
  while (i < n) out.push({ t: 'del', w: A[i++] }); while (j < m) out.push({ t: 'ins', w: B[j++] });
  return out;
}

// a split by a hash of the id: about 60% to learn from, 25% to race on, 15% sealed
export function bucket(id: string) { let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h % 100; }
export const splitOf = (id: string) => bucket(id) < 60 ? 'breeding' : bucket(id) < 85 ? 'race' : 'sealed';
