// Reading receipts: the text of a printed receipt, line by line; the answer is what was bought
// and the totals. From CORD v2 (CC BY 4.0): its train split to learn from, validation to race,
// test sealed.
import type { Arena, Control } from '../types.ts';
import { gradeReceipt, digits, similar, type Receipt } from './grade.ts';
import { genericStarters, genericControls } from '../generic.ts';

const field = { type: ['string', 'null'] };
export const receipts: Arena = {
  id: 'receipts', data: 'receipts', name: 'Read the receipt',
  describe: 'You are given the printed text of a shop receipt, line by line, as a scanner read it. Say what was bought (each item\'s name, how many and its price, as printed) and the subtotal, tax, total, cash given and change, as printed. Leave a field null when the receipt does not show it. Numbers are compared by their digits, so 45,500 and 45.500 are the same; names may differ by a letter or two.',
  answer: { type: 'object', required: ['items', 'total'], properties: { items: { type: 'array', items: { type: 'object', required: ['name', 'price'], properties: { name: { type: 'string' }, count: field, price: field } } }, subtotal: field, tax: field, total: field, cash: field, change: field } },
  grade: (answer, truth) => gradeReceipt(answer, truth as Receipt),
  inBrowser: true, kind: 'receipts',
  brief: input => { const lines = (input as { text: string }).text.split('\n'); return `${lines.length} lines: ${lines.slice(0, 2).join(' / ')}...`; },
  fromText: text => ({ text }),
  show: input => (input as { text: string }).text,
  valid: a => !!a && typeof a === 'object' && Array.isArray((a as Receipt).items),
  // a vote: the total most agents agree on, then the items of the first agent that gave that total
  merge: answers => { const rs = answers as Receipt[], n = new Map<string, number>(); for (const r of rs) n.set(digits(r.total), (n.get(digits(r.total)) ?? 0) + 1); const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; return rs.find(r => digits(r.total) === top) ?? rs[0] ?? null; },
  example: truth => JSON.stringify(truth),
  miss: (answer, truth) => {
    const a = (answer ?? {}) as Partial<Receipt>, t = truth as Receipt, wrong: string[] = [];
    for (const k of ['total', 'subtotal', 'tax', 'cash', 'change'] as const) if (digits(t[k]) && digits(a[k]) !== digits(t[k])) wrong.push(`${k} said ${a[k] ?? 'nothing'}, printed ${t[k]}`);
    const missed = t.items.filter(x => !(a.items ?? []).some(y => digits(y.price) === digits(x.price) && similar(String(y.name), x.name) >= .8));
    if (missed.length) wrong.push(`missed ${missed.length} of ${t.items.length} items, e.g. ${missed.slice(0, 3).map(x => `${x.name} ${x.price}`).join('; ')}`);
    const extra = (a.items ?? []).length - (t.items.length - missed.length); if (extra > 0) wrong.push(`listed ${extra} items that are not on it`);
    return wrong.join('; ') || 'close, but not exact';
  },
  tools: [{
    name: 'add_up',
    describe: 'Add up a list of amounts as printed (separators are ignored) and return the sum, to check items against a subtotal or total.',
    args: { type: 'object', required: ['amounts'], properties: { amounts: { type: 'array', items: { type: 'string' } } } },
    run: (a: { amounts?: string[] }) => { const xs = (a?.amounts ?? []).map(x => Number(digits(x)) || 0); return { sum: xs.reduce((s, x) => s + x, 0), of: xs.length }; },
  }],
};

const numbersIn = (text: string) => [...text.matchAll(/\d[\d.,]*\d|\d/g)].map(m => m[0]);
const control = (name: string, pick: (text: string) => string | null): Control => ({
  name, model: 'none',
  async answer(t) { const text = (t.input as { text: string }).text, total = pick(text); return { answer: { items: [], subtotal: null, tax: null, total, cash: null, change: null }, usd: 0, ms: 0, note: total ? `total read as ${total}` : 'no number found' }; },
});
receipts.starters = () => genericStarters(receipts);
receipts.controls = () => [
  // the largest amount printed is very often the total, or the cash handed over
  control('largest number', text => numbersIn(text).sort((a, b) => Number(digits(b)) - Number(digits(a)))[0] ?? null),
  // the first amount on a line that says total
  control('number after TOTAL', text => { const line = text.split('\n').find(l => /total/i.test(l) && !/sub/i.test(l)); return line ? numbersIn(line).at(-1) ?? null : null; }),
  genericControls(receipts)[1],
];
