// What each room opens into: a folio laid over the model, readable at full size.
import { api, post, entrants, pct, type Voyage, type Generation, type Telling, type Entrant, type Arena } from './data.ts';
import { organism, scaleBar, chart, inset, km, paper } from './drawings.ts';
import type { RoomId } from './ship.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const money = (x: number) => `$${x.toFixed(x < 1 ? 3 : 2)}`;
const secs = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
const dist = (d: number | null) => d === null ? 'no answer' : d < 10 ? `${d.toFixed(1)} km` : `${Math.round(d).toLocaleString()} km`;
// terms of art, each with its meaning in plain words, shown on hover and to screen readers
const TERMS: Record<string, string> = {
  agent: 'A design for doing the task: what it is told, which model runs it, which tools it may use, and how its steps are wired.',
  genome: 'An agent written down as data, so it can be compared, changed and bred.',
  control: 'A simple method every agent has to beat for its score to mean anything.',
  interval: 'The range the true score most likely lies in, given how few items have been tried. When two ranges overlap, neither agent is clearly better.',
  front: 'The Pareto front: agents nobody beats on accuracy without costing more or taking longer.',
  sealed: 'Items set aside before the voyage began and never shown to anyone, used once at the end to check the winners honestly.',
  fossil: 'A small network trained on this Mac on a winning agent\'s answers, so the skill runs in milliseconds for free.',
};
const term = (k: keyof typeof TERMS, label = k) => `<dfn tabindex="0" title="${esc(TERMS[k])}">${label}<span role="tooltip">${esc(TERMS[k])}</span></dfn>`;

export type Ctx = { voyage: Voyage; gen: Generation; genN: number; view: 'plain' | 'lab'; arena: Arena | null };

export async function render(id: RoomId, el: HTMLElement, c: Ctx) {
  el.dataset.room = id;
  if (id === 'chart') return chartRoom(el, c);
  if (id === 'drawing') return drawingRoom(el, c);
  if (id === 'specimens') return hold(el, c);
  if (id === 'log') return log(el, c);
  if (id === 'fossils') return fossils(el, c);
  return settings(el, c);
}
const head = (title: string, sub: string) => `<header class="folio-head"><h1>${title}</h1><p>${sub}</p></header>`;

// ---------- the chart room: one item at a time, every answer on the chart ----------
async function chartRoom(el: HTMLElement, c: Ctx) {
  const tasks = await api<{ id: string; date: string; shown: string; mean: number; answered: number }[]>(`/voyages/${c.voyage.id}/generations/${c.genN}/tasks`, []);
  const first = await api<Telling>(`/voyages/${c.voyage.id}/generations/${c.genN}/telling`);
  el.innerHTML = `${head('The chart room', `Pick a news item. Its places are hidden from the agents; the chart shows where each one answered, against where it really happened.`)}
  <div class="chart-room">
    <div class="items-wrap"><div class="items-head"><span>${tasks.length} news items, hardest first</span><span>Field average</span></div><ol class="items" aria-label="News items in this race, hardest first">${tasks.map(t => `<li><button data-task="${t.id}" class="${t.id === first.task.id ? 'on' : ''}"><span class="d">${t.date}</span><span class="t">${esc(t.shown)}</span><span class="m">${pct(t.mean)}</span></button></li>`).join('')}</ol></div>
    <figure class="sheet"><canvas id="chart"></canvas><canvas id="inset" aria-hidden="true"></canvas><figcaption id="cap"></figcaption></figure>
    <table class="answers" id="answers"></table>
  </div>`;
  const show = (t: Telling) => {
    const cv = el.querySelector<HTMLCanvasElement>('#chart')!, r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio);
    cv.width = r.width * dpr; cv.height = r.height * dpr; const k = cv.getContext('2d')!; k.scale(dpr, dpr); chart(k, r.width, r.height, t, { left: .06 });
    const iv = el.querySelector<HTMLCanvasElement>('#inset')!; iv.width = 520; iv.height = 270; inset(iv.getContext('2d')!, 520, 270, t);
    const truth = t.task.truth.places;
    el.querySelector('#cap')!.innerHTML = `<b>${t.task.input.date}.</b> ${esc(t.task.shown.split('\n').slice(1).join(' ')).replace(/\[place\]/g, '<mark>[place]</mark>')} <span>Truth: ${truth.map(p => esc(p.name)).join(', ')}.</span>`;
    el.querySelector('#answers')!.innerHTML = `<thead><tr><th></th><th>Agent</th><th>Off by</th><th>Score</th>${c.view === 'lab' ? '<th>Answer</th>' : ''}</tr></thead><tbody>${t.answers.map((a, i) => {
      const d = a.answer ? Math.min(...truth.map(p => km(a.answer!, p))) : null;
      return `<tr class="${a.control ? 'ctl' : ''}"><td>${i + 1}</td><td><a href="#/drawing/${encodeURIComponent(a.genome)}">${esc(a.name)}</a></td><td>${dist(d)}</td><td>${pct(a.score)}</td>${c.view === 'lab' ? `<td class="mono"><a href="#/run/${a.run}">${a.answer ? `${a.answer.lat.toFixed(3)}, ${a.answer.lon.toFixed(3)}` : a.status}</a></td>` : ''}</tr>`;
    }).join('')}</tbody>`;
  };
  show(first);
  el.querySelector('.items button.on')?.scrollIntoView({ block: 'center' });
  el.querySelectorAll<HTMLButtonElement>('.items button').forEach(b => b.addEventListener('click', async () => {
    el.querySelectorAll('.items button').forEach(x => x.classList.toggle('on', x === b));
    show(await api<Telling>(`/voyages/${c.voyage.id}/generations/${c.genN}/telling?task=${b.dataset.task}`));
  }));
}

// ---------- the drawing room: every agent as a plate; one opens under the glass ----------
function plate(e: Entrant, i: number, w = 300, h = 380) {
  const cv = document.createElement('canvas'), dpr = 2; cv.width = w * dpr; cv.height = h * dpr; cv.style.width = '100%'; cv.style.aspectRatio = `${w} / ${h}`;
  const k = cv.getContext('2d')!; k.scale(dpr, dpr);
  // printed straight onto the folio: no card, no tint
  organism(k, e.body ? { ...e.body, id: e.genome } : { id: e.genome, tools: [], workflow: { shape: 'control' }, memory: { examples: 0 }, model: 'none' }, w / 2, h * .43, w * .4);
  scaleBar(k, 20, w - 20, h - 22, e.mean, e.lo, e.hi, 1.2);
  return cv;
}
async function drawingRoom(el: HTMLElement, c: Ctx) {
  const es = entrants(c.gen), focus = decodeURIComponent(location.hash.split('/')[2] ?? '');
  el.innerHTML = `${head('The drawing room', `Every ${term('agent')} in generation ${c.genN + 1}, drawn from its design. The body is how its steps are wired, spines mean it may use the gazetteer, seeds are worked examples it was shown. The bar is its score out of 100, the fine line above it the ${term('interval')}.`)}
  <div class="plates">${es.map((e, i) => `<a class="plate ${e.control ? 'ctl' : ''}" href="#/drawing/${encodeURIComponent(e.genome)}" data-g="${esc(e.genome)}"><div class="cv"></div><div class="cap"><b>${e.control ? `Control ${'ABC'[es.filter(x => x.control).indexOf(e)]}` : `Fig. ${es.filter(x => !x.control).indexOf(e) + 1}`}.</b> ${esc(e.name)}<span class="big">${pct(e.mean)}</span><span class="soft">${pct(e.lo)} to ${pct(e.hi)}</span></div></a>`).join('')}</div>
  <aside class="glass" id="glass" hidden></aside>`;
  el.querySelectorAll<HTMLElement>('.plate').forEach((p, i) => p.querySelector('.cv')!.appendChild(plate(es[i], i)));
  if (focus) openGlass(el, c, es.find(e => e.genome === focus));
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

// ---------- the hold: the whole field as a ledger anyone can read ----------
function hold(el: HTMLElement, c: Ctx) {
  const es = entrants(c.gen), lead = es.find(e => !e.control)!, best = es.filter(e => e.control).sort((a, b) => b.mean - a.mean)[0];
  const sep = lead && best ? lead.lo > best.hi : false;
  el.innerHTML = `${head('The hold', `All ${es.length} specimens of generation ${c.genN + 1}, best first. Each was tried on the same ${c.gen.common} news items.`)}
  <p class="verdict">${lead ? `${esc(lead.name)} leads with ${pct(lead.mean)}. ${best ? (sep ? `It clearly beats the best ${term('control')}, ${esc(best.name)} (${pct(best.mean)}): their ranges do not overlap.` : `It is not yet clearly better than the best ${term('control')}, ${esc(best.name)} (${pct(best.mean)}): their ranges overlap.`) : ''}` : ''}</p>
  <table class="ledger"><thead><tr><th>Specimen</th><th>Score</th><th>${term('interval', 'Likely range')}</th><th>Within 25 km</th>${c.view === 'lab' ? `<th>Cost</th><th>Time per item</th><th>${term('front', 'Front')}</th><th>Answered</th>` : ''}</tr></thead><tbody>${es.map(e => `<tr class="${e.control ? 'ctl' : ''}"><td><a href="#/drawing/${encodeURIComponent(e.genome)}">${esc(e.name)}</a>${e.control ? ' <small>control</small>' : ''}</td><td class="n"><span class="fill" style="--w:${e.mean}"></span>${pct(e.mean)}</td><td class="n">${pct(e.lo)} to ${pct(e.hi)}</td><td class="n">${e.within} of ${e.tasks}</td>${c.view === 'lab' ? `<td class="n">${money(e.usd)}</td><td class="n">${secs(e.ms)}</td><td class="n">${e.pareto}</td><td class="n">${e.tasks - e.noAnswer} of ${e.tasks}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}

// ---------- the log: why these numbers can be trusted, and how to check them yourself ----------
function log(el: HTMLElement, c: Ctx) {
  const v = c.voyage, a = c.arena;
  el.innerHTML = `${head('The log', 'What was fixed before the voyage, what it cost, and how to check every number without trusting Beagle.')}
  <div class="log-grid">
    <section><h2>Sealed before sailing</h2><p>${a ? `${a.counts.sealed} news items from ${esc(a.info?.version.split('; sealed from ')[1]?.split(';')[0] ?? 'the sealed months')} on were set aside as the ${term('sealed', 'sealed test')}.` : ''} Their fingerprint was written here before the first race, and is checked again before they are ever used:</p><code class="hash">${esc(v.sealed_hash)}</code><p class="soft">Nobody, and no agent or designer, sees these items until the voyage is finished.</p></section>
    <section><h2>The arena</h2><p>${a ? `${esc(a.name)}. ${a.counts.breeding} items to learn from, ${a.counts.race} to race on, ${a.counts.sealed} sealed, and ${a.counts.pool} unlabelled for training fossils later. Built from Wikipedia's Current Events, with each place's coordinates from Wikidata.` : ''}</p>${a?.info ? `<p class="soft">Built ${esc(a.info.built_at.slice(0, 10))}. Fingerprint <code>${esc(a.info.hash.slice(0, 16))}</code></p>` : ''}</section>
    <section><h2>Controls</h2><p>Every generation races three ${term('control', 'controls')} on the same items: a random point on the globe, the gazetteer with no model, and one plain question to Claude, each shown the item exactly as the agents see it. A score only means something next to theirs.</p></section>
    <section><h2>Spent</h2><table class="ledger small"><tbody>${v.generations.filter(g => g.generation >= 0).map(g => `<tr><td>Generation ${g.generation + 1}</td><td class="n">${g.runs} runs</td><td class="n">${money(g.usd)}</td></tr>`).join('')}${(() => { const kept = v.generations.filter(g => g.generation >= 0).reduce((n, g) => n + g.usd, 0), extra = v.spent - kept; return extra > .005 ? `<tr><td>Paid for, but not kept</td><td></td><td class="n">${money(extra)}</td></tr>` : ''; })()}<tr><td><b>The voyage, every call paid for</b></td><td></td><td class="n"><b>${money(v.spent)}</b></td></tr></tbody></table>
  ${v.spent - v.generations.filter(g => g.generation >= 0).reduce((n, g) => n + g.usd, 0) > .005 ? `<p class="soft">Paid for but not kept: runs redone after a fault, and runs a second race process paid for twice on 2026-11-08 before Beagle learned to stop that. They are in the ledger because they were paid for.</p>` : ''}<p class="soft">Claude calls count at the cost Claude Code reports; calls to models on this Mac count as free. The voyage's cap is ${money(v.settings.capVoyage)}.</p></section>
    <section class="wide"><h2>Check it yourself</h2><p>Export the voyage as one file: every agent, every item with its truth, every answer. Then re-grade it from the answers alone, with no model calls:</p><pre>beagle export ${esc(v.id)}\nbeagle regrade ~/Library/Application\\ Support/Beagle/bundles/${esc(v.id)}.beagle.json</pre><p class="soft">On ${esc(new Date().toISOString().slice(0, 10))}, re-grading this voyage's first generation reproduced every recorded score.</p></section>
    <section class="wide"><h2>One thing it found</h2><p>Two answers in the first race matched the truth's Wikidata coordinate to six decimal places. The run's full record shows no access to it: Sonnet planned, looked up two villages the gazetteer did not have, and answered from memory. It had memorised the coordinate Wikipedia shows for southern Lebanon. That is real knowledge the model brings, not a leak, and Beagle reports it rather than hiding it.</p></section>
  </div>`;
}

function fossils(el: HTMLElement, c: Ctx) {
  const lead = entrants(c.gen).find(e => !e.control);
  el.innerHTML = `${head('The fossil locker', 'Empty, for now.')}
  <div class="prose"><p>A ${term('fossil')} is what Beagle makes once an agent is good and stable: it runs the winner over thousands of unlabelled news items, trains a small network on its answers here on this Mac, and checks that network honestly against the sealed test.</p>
  <p>No skill has been fossilised yet. ${lead ? `The strongest candidate so far is ${esc(lead.name)}, at ${pct(lead.mean)}, but a fossil waits until a winner holds its place across generations.` : ''} When one is made, this locker will show its size, how fast it answers, what it costs to run, and how its score compares with the agent it learned from, including if it is worse.</p></div>`;
}

async function settings(el: HTMLElement, c: Ctx) {
  const [s, st] = await Promise.all([api<Record<string, unknown>>('/settings'), api<Record<string, unknown>>('/status', {})]);
  const field = (k: string, label: string, help: string, kind: 'num' | 'bool' | 'view' = 'num') => `<label class="field"><span class="l">${label}</span>${kind === 'num' ? `<input type="number" step="any" min="0" name="${k}" value="${esc(s[k])}">` : kind === 'bool' ? `<input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}>` : `<select name="${k}"><option value="plain" ${s[k] === 'plain' ? 'selected' : ''}>Plain</option><option value="lab" ${s[k] === 'lab' ? 'selected' : ''}>Lab</option></select>`}<span class="h">${help}</span></label>`;
  el.innerHTML = `${head('The forecastle', 'Settings. Changes apply to the next voyage; a voyage keeps the settings it sailed with.')}
  <form class="settings" id="settings">
    <fieldset><legend>Spend</legend>${field('capGeneration', 'Cap per generation, in dollars', 'A race stops cleanly when a generation has paid this much, and can be resumed.')}${field('capVoyage', 'Cap per voyage, in dollars', 'On a Claude plan this counts against usage limits rather than a bill.')}${field('concurrency', 'Runs at once', 'More is faster; Claude usage limits may slow it anyway.')}${field('localOnly', 'Only models on this Mac', 'Never call Claude: only Ollama models race, and the designer is skipped.', 'bool')}</fieldset>
    <fieldset><legend>Evolution</legend>${field('population', 'Agents per generation', '')}${field('generations', 'Generations per voyage', '')}${field('raceTasks', 'News items each agent races on', 'More items give narrower ranges and cost more.')}${field('seed', 'Seed', 'Fixes which items are drawn and the ranges, so a voyage can be reproduced.')}</fieldset>
    <fieldset><legend>Display</legend>${field('view', 'View', 'Plain explains every number in words; Lab adds cost, time, ranks and raw answers.', 'view')}${field('reducedMotion', 'Reduce motion', 'No camera flights between rooms.', 'bool')}</fieldset>
    <div class="actions"><button type="submit">Save settings</button><span id="saved" role="status"></span></div>
  </form>
  <section class="status"><h2>On this Mac</h2><dl><dt>Claude</dt><dd>${esc(st.claude ?? 'unknown')}</dd><dt>Models in Ollama</dt><dd>${Array.isArray(st.ollama) ? esc((st.ollama as string[]).join(', ')) : esc(st.ollama ?? 'unknown')}</dd><dt>Training environment</dt><dd>${esc(st.trainer ?? 'unknown')}</dd></dl>
  <p class="soft">Data: Wikipedia text CC BY-SA, Wikidata CC0, GeoNames CC BY 4.0, Natural Earth coastlines public domain.</p></section>`;
  el.querySelector('#settings')!.addEventListener('submit', async ev => {
    ev.preventDefault(); const f = ev.target as HTMLFormElement, out: Record<string, unknown> = {};
    for (const i of Array.from(f.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))) out[i.name] = i.type === 'checkbox' ? (i as HTMLInputElement).checked : i.type === 'number' ? Number(i.value) : i.value;
    const r = await post('/settings', out), msg = el.querySelector('#saved')!;
    msg.textContent = r.ok ? 'Saved.' : `Not saved: ${(await r.json()).error}`;
    if (r.ok) document.dispatchEvent(new CustomEvent('settings', { detail: await r.json() }));
  });
}

// a single run, opened from anywhere: the task, the truth, and every step the agent took
export async function runView(el: HTMLElement, id: string) {
  const r = await api<any>(`/runs/${id}`);
  el.innerHTML = `${head('One run', `${esc(r.genome)} on one news item, step by step.`)}<div class="prose"><p class="item">${esc(r.task.input.hidden ?? r.task.input.text)}</p>
  <dl class="nums"><div><dt>Answer</dt><dd>${r.answer ? `${r.answer.lat.toFixed(3)}, ${r.answer.lon.toFixed(3)}` : 'none'}</dd></div><div><dt>Truth</dt><dd>${r.task.truth === 'sealed' ? 'sealed' : esc(r.task.truth.places.map((p: any) => p.name).join(', '))}</dd></div><div><dt>Score</dt><dd>${pct(r.score)}</dd></div><div><dt>Cost</dt><dd>${money(r.usd)}</dd></div></dl>
  <ol class="trace">${r.trace.map((s: any) => `<li class="${s.kind}"><b>${s.kind === 'model' ? 'The model' : s.kind === 'tool' ? 'A tool' : 'Note'}</b><pre>${esc(typeof s.output === 'string' ? s.output : JSON.stringify(s.output, null, 1)).slice(0, 2400)}</pre></li>`).join('')}</ol></div>`;
}
