// The chart room for arenas that are not maps: the receipt desk (a receipt as printed, and how
// each agent read it), the test bench (the planted bug in its code, and each agent's mend), and
// the work table for arenas people define (the item, the truth, and every answer).
import { api, pct, type Telling } from './data.ts';
import { esc, head } from './ui.ts';
import type { Ctx } from './rooms.ts';

type Kind = 'receipts' | 'fixtest' | 'custom';
type Receipt = { items: { name: string; count?: string | null; price: string | null }[]; subtotal: string | null; tax: string | null; total: string | null; cash: string | null; change: string | null };
type Fix = { file: string; line: number; original: string; mutated: string; function: string; failing: string[] };
const digits = (x: unknown) => String(x ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const TITLE: Record<Kind, [string, string]> = {
  receipts: ['The receipt desk', 'Pick a receipt. The agents were given its printed text; the desk shows what each one read off it, field by field, against what is printed.'],
  fixtest: ['The test bench', 'Pick a bug. One line of the library was broken and these tests began to fail; the bench shows the broken line, and how each agent mended it, checked by the whole suite.'],
  custom: ['The work table', 'Pick an item. The table shows the item as the agents saw it, the true answer, and what each agent said.'],
};

export async function workTable(el: HTMLElement, c: Ctx, kind: Kind) {
  const tasks = await api<{ id: string; shown: string; mean: number }[]>(`/voyages/${c.voyage.id}/generations/${c.genN}/tasks`, []);
  const first = await api<Telling>(`/voyages/${c.voyage.id}/generations/${c.genN}/telling`, null as any);
  el.innerHTML = `${kind !== 'fixtest' ? `<nav class="pages chart-tabs"><a class="on" href="#/chart">The race items</a><a href="#/chart/own">Set your own item</a></nav>` : ''}${head(...TITLE[kind])}
  <div class="bench bench-${kind}">
    <div class="items-wrap"><div class="items-head"><span>${tasks.length} items, hardest first</span><span>Average</span></div><ol class="items">${tasks.map(t => `<li><button data-task="${esc(t.id)}" class="${t.id === first?.task.id ? 'on' : ''}"><span class="t">${esc(t.shown)}</span><span class="m">${pct(t.mean)}</span></button></li>`).join('')}</ol></div>
    <div class="bench-main" id="bench"></div>
  </div>`;
  const show = (t: Telling) => { el.querySelector('#bench')!.innerHTML = kind === 'receipts' ? receiptView(t) : kind === 'fixtest' ? benchView(t) : tableView(t); wire(el, t, kind); };
  if (first) show(first);
  el.querySelectorAll<HTMLButtonElement>('.items button').forEach(b => b.addEventListener('click', async () => {
    el.querySelectorAll('.items button').forEach(x => x.classList.toggle('on', x === b));
    show(await api<Telling>(`/voyages/${c.voyage.id}/generations/${c.genN}/telling?task=${encodeURIComponent(b.dataset.task!)}`));
  }));
}

// ---------- receipts ----------
function receiptView(t: Telling) {
  const truth = t.task.truth as unknown as Receipt, text = (t.task.input as unknown as { text: string }).text;
  const lines = text.split('\n');
  const reading = (a: Telling['answers'][0]) => {
    const r = (a.answer ?? {}) as unknown as Partial<Receipt>, found = truth.items.filter(x => (r.items ?? []).some(y => digits(y.price) === digits(x.price) && norm(String(y.name ?? '')) && similar(String(y.name), x.name)));
    return { r, found: found.length, total: digits(r.total) && digits(r.total) === digits(truth.total) };
  };
  return `<div class="desk">
    <figure class="slip" aria-label="The receipt as printed"><div class="paper">${lines.map((l, i) => `<div class="pl" data-l="${i}">${esc(l) || '&nbsp;'}</div>`).join('')}</div></figure>
    <div class="desk-side">
      <h3>Printed</h3>
      <table class="printed"><tbody>${truth.items.map(x => `<tr><td>${esc(x.count ?? '')}</td><td>${esc(x.name)}</td><td class="n">${esc(x.price ?? '')}</td></tr>`).join('')}
        ${(['subtotal', 'tax', 'total', 'cash', 'change'] as const).filter(k => truth[k]).map(k => `<tr class="sum"><td></td><td>${k}</td><td class="n">${esc(truth[k])}</td></tr>`).join('')}</tbody></table>
      <h3>How each agent read it</h3>
      <table class="readings"><thead><tr><th></th><th>Agent</th><th>Total</th><th>Items</th><th>Score</th></tr></thead><tbody>${t.answers.map((a, i) => { const g = reading(a); return `<tr class="${a.control ? 'ctl' : ''}" data-i="${i}" tabindex="0"><td>${i + 1}</td><td><a href="#/run/${esc(a.run)}">${esc(a.name)}</a></td><td class="${g.total ? 'ok' : 'no'}">${esc(g.r.total ?? '·')}</td><td>${g.found} of ${truth.items.length}</td><td class="n">${pct(a.score)}</td></tr>`; }).join('')}</tbody></table>
      <p class="soft">Point at an agent to see on the receipt which printed lines it read correctly.</p>
    </div></div>`;
}
function similar(a: string, b: string) { const x = norm(a), y = norm(b); if (!x || !y) return x === y; const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]); for (let j = 1; j <= y.length; j++) d[0][j] = j; for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); return 1 - d[x.length][y.length] / Math.max(x.length, y.length) >= .8; }

// ---------- the test bench ----------
function benchView(t: Telling) {
  const truth = t.task.truth as unknown as Fix, input = t.task.input as unknown as { output: string };
  const verdict = (a: Telling['answers'][0]) => { const edits = ((a.answer as any)?.edits ?? []) as { file: string; find: string; replace: string }[]; return { edits, word: a.status !== 'done' ? 'gave up' : !edits.length ? 'left it' : a.score >= 1 ? 'mended' : a.score > 0 ? 'part mended' : 'not mended' }; };
  return `<div class="bench-top">
    <div class="code-card"><header><span>${esc(truth.file)}</span><span>line ${truth.line}, in ${esc(truth.function)}</span></header>
      <pre class="code"><span class="ln">${truth.line}</span><del>${esc(truth.mutated.trim())}</del>\n<span class="ln">${truth.line}</span><ins>${esc(truth.original.trim())}</ins></pre>
      <p class="soft">Struck through: the line as broken. Beneath it: the line as it was. The agents saw neither, only the failing tests and the library.</p></div>
    <div class="failing"><h3>Tests that failed</h3><ul>${truth.failing.map(n => `<li>${esc(n)}</li>`).join('')}</ul><details><summary>The first failure, as the agents saw it</summary><pre class="out">${esc(input.output)}</pre></details></div>
  </div>
  <h3>How each agent mended it</h3>
  <div class="mends">${t.answers.map((a, i) => { const v = verdict(a); return `<article class="mend ${a.control ? 'ctl' : ''}"><header><span class="no">${i + 1}</span><a href="#/run/${esc(a.run)}">${esc(a.name)}</a><span class="stamp-s ${v.word.replace(' ', '-')}">${v.word}</span><span class="n">${pct(a.score)}</span></header>
    ${v.edits.length ? v.edits.map(e => `<pre class="code small"><span class="f">${esc(e.file)}</span>\n<del>${esc(String(e.find).trim())}</del>\n<ins>${esc(String(e.replace).trim())}</ins></pre>`).join('') : '<p class="soft">No edit.</p>'}</article>`; }).join('')}</div>`;
}

// ---------- your own arena ----------
function tableView(t: Telling) {
  // an answer in words: a lone field shows as its value, several as "field: value"
  const show = (x: unknown): string => typeof x === 'string' ? esc(x) : x && typeof x === 'object' && !Array.isArray(x) ? Object.entries(x).map(([k, v], _i, all) => all.length === 1 ? show(v) : `${esc(k)}: ${show(v)}`).join('; ') : esc(JSON.stringify(x));
  return `<div class="worktop"><p class="item-big">${show(t.task.input)}</p><p class="truth-line">The answer: <b>${show(t.task.truth)}</b></p></div>
  <table class="answers"><thead><tr><th></th><th>Agent</th><th>Said</th><th>Score</th></tr></thead><tbody>${t.answers.map((a, i) => `<tr class="${a.control ? 'ctl' : ''}"><td>${i + 1}</td><td><a href="#/run/${esc(a.run)}">${esc(a.name)}</a></td><td class="mono">${a.answer ? show(a.answer) : '<em>no answer</em>'}</td><td>${pct(a.score)}</td></tr>`).join('')}</tbody></table>`;
}

function wire(el: HTMLElement, t: Telling, kind: Kind) {
  if (kind !== 'receipts') return;
  const lines = [...el.querySelectorAll<HTMLElement>('.pl')], truth = t.task.truth as unknown as Receipt;
  const mark = (i: number | null) => {
    lines.forEach(l => l.className = 'pl');
    if (i === null) return;
    const r = (t.answers[i].answer ?? {}) as unknown as Partial<Receipt>;
    // a printed line is read right when an amount on it is one the agent gave in the right place
    lines.forEach(l => {
      const ds = (l.textContent!.match(/\d[\d.,]*\d|\d/g) ?? []).map(digits); if (!ds.length) return;
      const okItem = truth.items.some(x => ds.includes(digits(x.price)) && (r.items ?? []).some(y => digits(y.price) === digits(x.price) && similar(String(y.name ?? ''), x.name)));
      const okSum = (['subtotal', 'tax', 'total', 'cash', 'change'] as const).some(k => truth[k] && ds.includes(digits(truth[k])) && digits(r[k]) === digits(truth[k]));
      const printed = truth.items.some(x => ds.includes(digits(x.price))) || (['subtotal', 'tax', 'total', 'cash', 'change'] as const).some(k => truth[k] && ds.includes(digits(truth[k])));
      if (okItem || okSum) l.classList.add('read'); else if (printed) l.classList.add('missed');
    });
  };
  el.querySelectorAll<HTMLElement>('.readings tbody tr').forEach(tr => { const i = Number(tr.dataset.i); tr.addEventListener('mouseenter', () => mark(i)); tr.addEventListener('focus', () => mark(i)); tr.addEventListener('mouseleave', () => mark(null)); });
}

// your own item, for arenas that are not maps: write or paste it, pick who answers, read what they said
export function ownPlain(el: HTMLElement, c: Ctx, kind: Kind, es: import('./data.ts').Entrant[], ask: (genome: string, text: string, paid: boolean) => Promise<any>) {
  const local = (e: import('./data.ts').Entrant) => e.control ? !e.genome.includes('Claude') : !(e.body?.model ?? '').startsWith('claude:');
  const per = (e: import('./data.ts').Entrant) => e.tasks ? e.usd / e.tasks : 0;
  el.innerHTML = `<nav class="pages chart-tabs"><a href="#/chart">The race items</a><a class="on" href="#/chart/own">Set your own item</a></nav>${head('Set your own item', kind === 'receipts' ? 'Paste the text of any receipt, line by line. Pick who reads it.' : 'Write an item the way this arena\'s items are written. Pick who answers.')}
  <div class="own"><form class="own-form" id="own"><label class="field"><span class="l">${kind === 'receipts' ? 'The receipt' : 'The item'}</span><textarea name="text" rows="${kind === 'receipts' ? 12 : 4}" class="${kind === 'receipts' ? 'mono' : ''}"></textarea></label>
    <fieldset class="who"><legend>Who answers</legend>${es.filter(e => !e.genome.includes('random') && e.genome !== 'baseline:no change').map(e => `<label class="pick"><input type="checkbox" name="g" value="${esc(e.genome)}" ${local(e) ? 'checked' : ''}><span>${esc(e.name)}</span><small>${local(e) ? 'free, on this Mac' : `about $${per(e).toFixed(3)}`}</small></label>`).join('')}</fieldset>
    <button type="submit" class="ask">Ask them</button></form>
    <div class="own-out"><table class="answers" id="answers"></table></div></div>`;
  const form = el.querySelector<HTMLFormElement>('#own')!;
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = new FormData(form), text = String(fd.get('text') ?? '').trim(); if (!text) return;
    const picked = fd.getAll('g').map(g => es.find(e => e.genome === g)!).filter(Boolean), paid = picked.filter(e => !local(e));
    if (paid.length && !confirm(`${paid.length} of these run on Claude and cost about $${paid.reduce((n, e) => n + per(e), 0).toFixed(3)} in all. Ask them?`)) return;
    const rows = picked.map(e => ({ e, out: '<em>asking...</em>' }));
    const draw = () => { el.querySelector('#answers')!.innerHTML = `<thead><tr><th>Agent</th><th>Said</th></tr></thead><tbody>${rows.map(r => `<tr class="${r.e.control ? 'ctl' : ''}"><td>${esc(r.e.name)}</td><td class="mono">${r.out}</td></tr>`).join('')}</tbody>`; };
    draw();
    await Promise.all(rows.map(async r => { try { const j = await ask(r.e.genome, text, !local(r.e)); r.out = j.error ? `<em>${esc(j.error)}</em>` : j.answer ? esc(JSON.stringify(j.answer, null, 1)) : '<em>no answer</em>'; } catch (e) { r.out = esc((e as Error).message); } draw(); }));
  });
}
