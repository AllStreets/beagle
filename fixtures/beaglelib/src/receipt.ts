// Reading a receipt: what was bought, at what price, and the totals. Numbers count when their
// digits agree, whatever the separators; item names count when they are close enough, so a
// typo in the receipt or the answer is not fatal. Only the fields a receipt has are scored.
export type Item = { name: string; count?: string | null; price: string | null };
export type Receipt = { items: Item[]; subtotal: string | null; tax: string | null; total: string | null; cash: string | null; change: string | null };

export const digits = (x: unknown) => String(x ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// 1 for the same text, falling with the edit distance
export function similar(a: string, b: string) {
  const x = norm(a), y = norm(b); if (!x && !y) return 1; if (!x || !y) return 0;
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return 1 - d[x.length][y.length] / Math.max(x.length, y.length);
}

const WEIGHT = { total: .3, subtotal: .1, tax: .1, cash: .05, change: .05, items: .4 };

export function gradeReceipt(answer: unknown, truth: Receipt): number {
  const a = answer as Partial<Receipt> | null;
  if (!a || typeof a !== 'object' || (a.items !== undefined && !Array.isArray(a.items))) return 0;
  let got = 0, out = 0;
  for (const k of ['total', 'subtotal', 'tax', 'cash', 'change'] as const) {
    if (!digits(truth[k])) continue;
    out += WEIGHT[k]; if (digits(a[k]) === digits(truth[k])) got += WEIGHT[k];
  }
  if (truth.items.length) {
    // each true item may be matched once, by the closest name with the same price
    const left = [...truth.items]; let hit = 0;
    for (const x of (a.items ?? []) as Item[]) {
      if (!x || typeof x !== 'object') continue;
      const i = left.findIndex(t => digits(t.price) === digits(x.price) && similar(String(x.name ?? ''), t.name) >= .8);
      if (i >= 0) { hit++; left.splice(i, 1); }
    }
    const given = ((a.items ?? []) as unknown[]).length, p = given ? hit / given : 0, r = hit / truth.items.length;
    out += WEIGHT.items; got += WEIGHT.items * (p + r ? 2 * p * r / (p + r) : 0);
  }
  return out ? got / out : 0;
}

// ---- from CORD v2's ground truth ----
type Word = { text: string; row_id: number; quad: { x1: number; y1: number } };
type Gt = { gt_parse: any; valid_line: { words: Word[]; category: string }[] };
const list = (x: unknown) => Array.isArray(x) ? x : x ? [x] : [];
const str = (x: unknown) => typeof x === 'string' ? x : Array.isArray(x) ? String(x[0] ?? '') || null : null;

export function truthOf(gt: Gt): Receipt {
  const p = gt.gt_parse ?? {}, st = p.sub_total ?? {}, t = p.total ?? {};
  return {
    items: list(p.menu).filter((m: any) => m && m.nm).map((m: any) => ({ name: str(m.nm) ?? '', count: str(m.cnt), price: str(m.price) })),
    subtotal: str(st.subtotal_price), tax: str(st.tax_price), total: str(t.total_price), cash: str(t.cashprice), change: str(t.changeprice),
  };
}

// the receipt as a reader sees it: the words of each printed row, rows top to bottom
export function textOf(gt: Gt): string {
  const rows = new Map<number, Word[]>();
  for (const l of gt.valid_line ?? []) for (const w of l.words ?? []) { if (!rows.has(w.row_id)) rows.set(w.row_id, []); rows.get(w.row_id)!.push(w); }
  return [...rows.values()].map(ws => ({ y: Math.min(...ws.map(w => w.quad.y1)), line: ws.sort((a, b) => a.quad.x1 - b.quad.x1).map(w => w.text).join(' ') }))
    .sort((a, b) => a.y - b.y).map(r => r.line).join('\n');
}
