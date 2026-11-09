// What each room opens into: a folio laid over the model, readable at full size.
import { api, post, entrants, pct, type Voyage, type Generation, type Telling, type Entrant, type Arena } from './data.ts';
import { organism, scaleBar, chart, inset, km, paper } from './drawings.ts';
import type { RoomId } from './ship.ts';

import { esc, money, secs, dist, term, head } from './ui.ts';
import { logbook } from './logbook.ts';
import { chartRoom } from './chartroom.ts';
import { fossilRoom } from './fossilroom.ts';
import { holdRoom } from './holdroom.ts';
import { orders } from './orders.ts';

export type Ctx = { voyage: Voyage; gen: Generation; genN: number; view: 'plain' | 'lab'; arena: Arena | null; others?: { id: string; spent: number; note: string | null }[] };

export async function render(id: RoomId, el: HTMLElement, c: Ctx) {
  el.dataset.room = id;
  if (id === 'chart') return chartRoom(el, c);
  if (id === 'drawing') return drawingRoom(el, c);
  if (id === 'specimens') return holdRoom(el, c);
  if (id === 'log') return logbook(el, c);
  if (id === 'fossils') return fossilRoom(el, c);
  return orders(el, c);
}

// ---------- the chart room: one item at a time, every answer on the chart ----------
// ---------- the drawing room: every agent as a plate; one opens under the glass ----------
function plate(e: Entrant, i: number, w = 300, h = 380) {
  const cv = document.createElement('canvas'), dpr = 2; cv.width = w * dpr; cv.height = h * dpr; cv.style.width = '100%'; cv.style.aspectRatio = `${w} / ${h}`;
  const k = cv.getContext('2d')!; k.scale(dpr, dpr);
  // printed straight onto the folio: no card, no tint
  organism(k, e.body ? { ...e.body, id: e.genome } : { id: e.genome, tools: [], workflow: { shape: 'control' }, memory: { examples: 0 }, model: 'none' }, w / 2, h * .43, w * .4);
  scaleBar(k, 20, w - 20, h - 22, e.mean, e.lo, e.hi, 1.2);
  return cv;
}
type Node = { id: string; name: string; model: string; generation: number; parents: string[]; kept: boolean; reason: string | null; mean: number | null; lo: number | null; hi: number | null; genome: any };
async function drawingRoom(el: HTMLElement, c: Ctx) {
  if (location.hash.startsWith('#/drawing/lineage')) return lineage(el, c);
  const es = entrants(c.gen), focus = decodeURIComponent(location.hash.split('/')[2] ?? '');
  el.innerHTML = `<nav class="pages"><a class="on" href="#/drawing">The plates</a><a href="#/drawing/lineage">The lineage</a></nav>${head('The drawing room', `Every ${term('agent')} in generation ${c.genN + 1}, drawn from its design. The body is how its steps are wired, spines mean it may use the gazetteer, seeds are worked examples it was shown. The bar is its score out of 100, the fine line above it the ${term('interval')}.`)}
  <div class="plates">${es.map((e, i) => `<a class="plate ${e.control ? 'ctl' : ''}" href="#/drawing/${encodeURIComponent(e.genome)}" data-g="${esc(e.genome)}"><div class="cv"></div><div class="cap"><b>${e.control ? `Control ${'ABC'[es.filter(x => x.control).indexOf(e)]}` : `Fig. ${es.filter(x => !x.control).indexOf(e) + 1}`}.</b> ${esc(e.name)}<span class="big">${pct(e.mean)}</span><span class="soft">${pct(e.lo)} to ${pct(e.hi)}</span></div></a>`).join('')}</div>
  <aside class="glass" id="glass" hidden></aside>`;
  el.querySelectorAll<HTMLElement>('.plate').forEach((p, i) => p.querySelector('.cv')!.appendChild(plate(es[i], i)));
  if (focus) openGlass(el, c, es.find(e => e.genome === focus));
}
// the field journal: every generation in a column, each agent joined to the ones it came from
async function lineage(el: HTMLElement, c: Ctx) {
  const nodes = await api<Node[]>(`/voyages/${c.voyage.id}/lineage`, []);
  const gens = [...new Set(nodes.map(n => n.generation))].sort((a, b) => a - b);
  // columns share the folio's width; past about four generations the journal scrolls sideways
  const avail = Math.max(600, el.clientWidth - 40), colW = Math.max(300, Math.min(440, Math.floor((avail - 30) / gens.length))), nodeW = colW - 120;
  const rowH = 92, top = 70, H = top + Math.max(...gens.map(g => nodes.filter(n => n.generation === g).length)) * rowH + 30, W = gens.length * colW + 40;
  const pos = new Map<string, { x: number; y: number }>();
  gens.forEach((g, gi) => nodes.filter(n => n.generation === g).sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1)).forEach((n, i) => pos.set(`${g}:${n.id}`, { x: 30 + gi * colW, y: top + i * rowH })));
  const hasChild = new Set(nodes.flatMap(n => n.parents.map(p => `${n.generation - 1}:${p}`)).concat(nodes.filter(n => n.kept).map(n => `${n.generation - 1}:${n.id}`)));
  const best = (g: number) => Math.max(...nodes.filter(n => n.generation === g && n.mean !== null).map(n => n.mean!));
  let lines = '';
  for (const n of nodes) {
    const to = pos.get(`${n.generation}:${n.id}`)!;
    for (const p of n.kept ? [n.id] : n.parents) { const from = pos.get(`${n.generation - 1}:${p}`); if (!from) continue; const x0 = from.x + nodeW + 6, y0 = from.y + 26, x1 = to.x - 6, y1 = to.y + 26, mx = (x0 + x1) / 2; lines += `<path d="M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}" class="${n.kept ? 'kept' : ''}"/>`; }
  }
  el.innerHTML = `<nav class="pages"><a href="#/drawing">The plates</a><a class="on" href="#/drawing/lineage">The lineage</a></nav>${head('The lineage', `Every agent of the voyage, one column per generation, best at the top. A line joins each agent to the ones it was bred from; a double line means it was kept unchanged. Agents with no line onward died out.`)}
  <div class="journal-wrap"><div class="journal" style="--node-w:${nodeW}px"><div class="cols">${gens.map((g, gi) => `<div class="colhead" style="left:${30 + gi * colW}px">Generation ${g + 1}<small>best ${best(g) >= 0 ? pct(best(g)) : 'not raced'}</small></div>`).join('')}</div>
  <svg class="ink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${lines}</svg>
  ${nodes.map(n => { const p = pos.get(`${n.generation}:${n.id}`)!, dead = n.generation < gens.at(-1)! && !hasChild.has(`${n.generation}:${n.id}`); return `<a class="node ${dead ? 'dead' : ''}" style="left:${p.x}px;top:${p.y}px" href="#/drawing/${encodeURIComponent(n.id)}" title="${esc(n.reason ?? '')}"><canvas width="104" height="104" data-n="${esc(n.id)}"></canvas><span><b>${esc(n.name)}</b><em>${n.mean === null ? 'racing' : pct(n.mean)}</em></span></a>`; }).join('')}
  </div></div>
  ${nodes.filter(n => n.generation > 0 && !n.kept).length ? `<h2 class="why">Why each child was made</h2><ol class="reasons">${nodes.filter(n => n.generation > 0 && !n.kept).map(n => `<li><b>${esc(n.name)}</b>, from ${n.parents.map(p => esc(nodes.find(x => x.id === p)?.name ?? p)).join(' and ')}: ${esc(n.reason ?? '')}</li>`).join('')}</ol>` : '<p class="soft">Only the first generation has raced so far. The designer breeds the next one from what it can see of this one.</p>'}`;
  el.querySelector<HTMLElement>('.journal')!.style.height = `${H}px`; el.querySelector<HTMLElement>('.journal')!.style.width = `${W}px`;
  el.querySelectorAll<HTMLCanvasElement>('.node canvas').forEach(cv => { const n = nodes.find(x => x.id === cv.dataset.n)!; const k = cv.getContext('2d')!; organism(k, n.genome ? { ...n.genome, id: n.id } : { id: n.id, tools: [], workflow: { shape: 'control' }, memory: { examples: 0 }, model: 'none' }, 52, 52, 30); });
}

async function openGlass(el: HTMLElement, c: Ctx, e?: Entrant) {
  const g = el.querySelector<HTMLElement>('#glass')!; if (!e) return;
  const runs = await api<{ id: string; task: string; score: number; status: string; usd: number; ms: number }[]>(`/voyages/${c.voyage.id}/runs?generation=${c.genN}&genome=${encodeURIComponent(e.genome)}`, []);
  const b = e.body;
  g.hidden = false;
  g.innerHTML = `<button class="close" aria-label="Close">Close</button><h2>${esc(e.name)}</h2>
    <p class="lede">${b ? `Runs on <b>${esc(b.model.replace(/^(claude|ollama):/, ''))}</b>${b.model.startsWith('ollama:') ? ', on this Mac' : ', through Claude Code'}. ${({ single: 'It reads the item and answers in one go.', 'plan-then-answer': 'It writes a plan first, then carries it out.', 'self-check': 'It answers, then checks its own answer before giving it.', vote: `It answers ${b.workflow.n} times and gives the answer in the middle of the others.` } as Record<string, string>)[b.workflow.shape] ?? ''} ${b.tools.length ? 'It may look places up in the gazetteer.' : 'It has no tools.'} ${b.memory.examples ? `It is shown ${b.memory.examples} worked examples.` : ''}` : `A ${term('control')}: ${esc(e.name)}.`}</p>
    <dl class="nums"><div><dt>Score</dt><dd>${pct(e.mean)}</dd></div><div><dt>${term('interval', 'Likely range')}</dt><dd>${pct(e.lo)} to ${pct(e.hi)}</dd></div><div><dt>Within 25 km</dt><dd>${e.within} of ${e.tasks}</dd></div><div><dt>Cost</dt><dd>${money(e.usd)}</dd></div><div><dt>Time per item</dt><dd>${secs(e.ms)}</dd></div><div><dt>${term('front', 'Front')}</dt><dd>${e.pareto === 1 ? 'on it' : `rank ${e.pareto}`}</dd></div></dl>
    ${b ? `<h3>What it is told</h3><blockquote>${esc(b.instructions)}</blockquote>` : ''}
    <h3>Every item it answered</h3><ol class="runs">${runs.map(r => `<li><a href="#/run/${r.id}"><span class="bar" style="--w:${r.score}"></span><span>${pct(r.score)}</span>${r.status === 'no-answer' ? '<em>no answer</em>' : ''}</a></li>`).join('')}</ol>`;
  g.querySelector('.close')!.addEventListener('click', () => { location.hash = '#/drawing'; });
}



// a single run, opened from anywhere: the task, the truth, and every step the agent took
export async function runView(el: HTMLElement, id: string) {
  const r = await api<any>(`/runs/${id}`);
  el.innerHTML = `${head('One run', `${esc(r.genome)} on one news item, step by step.`)}<div class="prose"><p class="item">${esc(r.task.input.hidden ?? r.task.input.text)}</p>
  <dl class="nums"><div><dt>Answer</dt><dd>${r.answer ? `${r.answer.lat.toFixed(3)}, ${r.answer.lon.toFixed(3)}` : 'none'}</dd></div><div><dt>Truth</dt><dd>${r.task.truth === 'sealed' ? 'sealed' : esc(r.task.truth.places.map((p: any) => p.name).join(', '))}</dd></div><div><dt>Score</dt><dd>${pct(r.score)}</dd></div><div><dt>Cost</dt><dd>${money(r.usd)}</dd></div></dl>
  <ol class="trace">${r.trace.map((s: any) => `<li class="${s.kind}"><b>${s.kind === 'model' ? 'The model' : s.kind === 'tool' ? 'A tool' : 'Note'}</b><pre>${esc(typeof s.output === 'string' ? s.output : JSON.stringify(s.output, null, 1)).slice(0, 2400)}</pre></li>`).join('')}</ol></div>`;
}
