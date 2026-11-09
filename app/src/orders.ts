// The forecastle: Settings, written as the standing orders for the next voyage, a printed
// broadside with blanks to fill. Beside it, the purser's estimate: what those orders would cost
// and how long they would take, worked from what this voyage actually paid per item.
import { api, post, entrants, type Entrant } from './data.ts';
import { esc, money } from './ui.ts';
import type { Ctx } from './rooms.ts';

type Settings = Record<string, number | boolean | string>;
const hours = (ms: number) => ms < 60_000 ? `${Math.round(ms / 1000)} seconds` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} minutes` : `${(ms / 3_600_000).toFixed(1)} hours`;

export async function orders(el: HTMLElement, c: Ctx) {
  const [s, st, full] = await Promise.all([api<Settings>('/settings'), api<Record<string, unknown>>('/status', {}), api<any>(`/voyages/${c.voyage.id}`, null)]);
  const num = (k: string, w = 4, step = 'any') => `<input class="blank" type="number" step="${step}" min="0" name="${k}" value="${esc(s[k])}" style="--w:${w}ch" aria-label="${k}">`;
  const box = (k: string) => `<input class="tick" type="checkbox" name="${k}" ${s[k] ? 'checked' : ''} aria-label="${k}">`;
  el.innerHTML = `<div class="broadside">
  <form id="settings" class="orders">
    <p class="bs-top">H.M.S. Beagle &nbsp;·&nbsp; the forecastle</p>
    <h1 class="bs-title">Standing Orders</h1>
    <p class="bs-sub">for the next voyage. A voyage keeps the orders it sailed with; these apply from the next one.</p>
    <div class="bs-rule"></div>
    <h2>I. &nbsp;Of money</h2>
    <p>No generation shall spend more than $${num('capGeneration', 4)}, and the voyage no more than $${num('capVoyage', 4)}. A race stops cleanly at its cap and can be resumed. On a Claude plan this counts against usage limits rather than a bill.</p>
    <p>At most ${num('concurrency', 3, '1')} runs shall go at once. More is faster, though Claude's limits may slow it anyway.</p>
    <p class="clause">${box('localOnly')} Only the models on this Mac shall be used: Claude shall not be called, and the designer shall rest.</p>
    <h2>II. &nbsp;Of breeding</h2>
    <p>Each generation shall number ${num('population', 3, '1')} agents, and the voyage shall run to ${num('generations', 3, '1')} generations.</p>
    <p>Every agent shall be tried on the same ${num('raceTasks', 4, '1')} news items, drawn by the seed ${num('seed', 5, '1')}. More items give narrower ranges and cost more; the seed fixes the draw, so a voyage can be worked again.</p>
    <h2>III. &nbsp;Of the rooms</h2>
    <p>The rooms shall be shown in the <select class="blank" name="view"><option value="plain" ${s.view === 'plain' ? 'selected' : ''}>plain</option><option value="lab" ${s.view === 'lab' ? 'selected' : ''}>lab</option></select> view. Plain explains every number in words; lab adds cost, time, ranks and raw answers.</p>
    <p class="clause">${box('reducedMotion')} The camera shall not fly between rooms.</p>
    <div class="bs-rule"></div>
    <div class="actions"><button type="submit" class="sign">Sign these orders</button><span id="saved" role="status"></span></div>
  </form>
  <aside class="purser">
    <h2>The purser's estimate</h2>
    <p class="soft" id="est-basis"></p>
    <dl id="est"></dl>
    <canvas id="est-bars" aria-hidden="true"></canvas>
    <p id="est-say"></p>
    <h2 class="company">The ship's company</h2>
    <dl class="company-list"><dt>Claude</dt><dd>${esc(st.claude ?? 'unknown')}</dd><dt>Models in Ollama</dt><dd>${Array.isArray(st.ollama) ? esc((st.ollama as string[]).join(', ')) : esc(st.ollama ?? 'unknown')}</dd><dt>Training</dt><dd>${esc(st.trainer ?? 'unknown')}</dd></dl>
    <p class="soft">Data: Wikipedia text CC BY-SA, Wikidata CC0, GeoNames CC BY 4.0, Natural Earth coastlines public domain.</p>
  </aside></div>`;

  const f = el.querySelector<HTMLFormElement>('#settings')!;
  const read = () => { const o: Settings = {}; for (const i of Array.from(f.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))) o[i.name] = i.type === 'checkbox' ? (i as HTMLInputElement).checked : i.type === 'number' ? Number(i.value) : i.value; return o; };
  const estimate = () => purser(el, c, read(), full);
  f.addEventListener('input', estimate); f.addEventListener('change', estimate); estimate();
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const r = await post('/settings', read()), msg = el.querySelector('#saved')!;
    msg.textContent = r.ok ? `Signed, ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.` : `Not signed: ${(await r.json()).error}`;
    if (r.ok) document.dispatchEvent(new CustomEvent('settings', { detail: await r.json() }));
  });
}

// what the orders would cost, from this voyage's own record: each agent's cost and time per item,
// the controls', and what the designer paid per generation
function purser(el: HTMLElement, c: Ctx, o: Settings, full: any) {
  const es = entrants(c.gen), agents = es.filter(e => !e.control), local = (e: Entrant) => !(e.body?.model ?? '').startsWith('claude:');
  const localOnly = !!o.localOnly, pool = localOnly ? agents.filter(local) : agents, P = Number(o.population) || 0, G = Number(o.generations) || 0, T = Number(o.raceTasks) || 0, K = Math.max(1, Number(o.concurrency) || 1);
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const agentUsd = avg(pool.map(e => e.usd / Math.max(1, e.tasks))), agentMs = avg(pool.map(e => e.ms));
  const ctl = es.filter(e => e.control && !(localOnly && e.genome.includes('Claude')));
  const ctlUsd = ctl.reduce((n, e) => n + e.usd / Math.max(1, e.tasks), 0), ctlMs = ctl.reduce((n, e) => n + e.ms, 0);
  const design = localOnly ? 0 : avg(((full?.design ?? []) as { usd: number }[]).map(d => d.usd));
  const perGen = T * (P * agentUsd + ctlUsd), genMs = T * (P * agentMs + ctlMs) / K;
  const gens = Array.from({ length: G }, (_, i) => perGen + (i ? design : 0));
  const total = gens.reduce((a, b) => a + b, 0), capG = Number(o.capGeneration) || 0, capV = Number(o.capVoyage) || 0;
  el.querySelector('#est-basis')!.textContent = `Worked from generation ${c.genN + 1} of voyage ${c.voyage.id.slice(-6)}: what its ${pool.length} ${localOnly ? 'local ' : ''}agents and ${ctl.length} controls actually paid and took per item, and what the designer paid per generation.`;
  el.querySelector('#est')!.innerHTML = `<div><dt>An agent, per item</dt><dd>${money(agentUsd)}</dd></div><div><dt>A generation</dt><dd>${money(Math.max(...gens, 0))}</dd></div><div><dt>The voyage</dt><dd>${money(total)}</dd></div><div><dt>Time, a generation</dt><dd>${hours(genMs)}</dd></div><div><dt>Time, the voyage</dt><dd>${hours(genMs * G)}</dd></div><div><dt>Runs</dt><dd>${(G * T * (P + ctl.length)).toLocaleString('en-GB')}</dd></div>`;
  // one bar per generation against its cap, and the running total against the voyage's
  const cv = el.querySelector<HTMLCanvasElement>('#est-bars')!, r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio), W = r.width, H = r.height;
  cv.width = W * dpr; cv.height = H * dpr; const k = cv.getContext('2d')!; k.setTransform(dpr, 0, 0, dpr, 0, 0);
  const top = Math.max(capG, ...gens, .01) * 1.15, bw = Math.min(46, (W - 40) / Math.max(1, G) - 8), y = (v: number) => H - 24 - (v / top) * (H - 44);
  k.font = '12px Rokkitt, serif'; k.textAlign = 'center';
  gens.forEach((g, i) => { const x = 30 + i * (bw + 8); k.fillStyle = g > capG ? '#a8463a' : '#4b3f30'; k.fillRect(x, y(g), bw, H - 24 - y(g)); k.fillStyle = '#4b3f30'; k.fillText(String(i + 1), x + bw / 2, H - 8); });
  k.lineWidth = 1.4; k.setLineDash([5, 3]); for (const col of ['#f3ecda', '#241c14']) { k.strokeStyle = col; k.lineDashOffset = col === '#241c14' ? 0 : 4; k.beginPath(); k.moveTo(24, y(capG)); k.lineTo(W - 4, y(capG)); k.stroke(); } k.setLineDash([]);
  k.fillStyle = '#8f2a1c'; k.textAlign = 'right'; k.fillText(`cap ${money(capG)}`, W - 6, y(capG) - 5);
  const over = gens.filter(g => g > capG).length, say = el.querySelector<HTMLElement>('#est-say')!;
  say.className = over || total > capV ? 'warn' : 'ok';
  say.textContent = !P || !G || !T ? 'Fill in the agents, generations and items to see an estimate.'
    : over ? `${over === G ? 'Every generation' : `${over} generation${over === 1 ? '' : 's'}`} would reach ${money(capG)} before finishing, and stop with about ${Math.floor(T * capG / Math.max(...gens))} of ${T} items done. Raise the cap or race fewer items.`
    : total > capV ? `The voyage would reach its ${money(capV)} cap after about ${Math.floor(capV / Math.max(...gens))} generations of ${G}.`
    : `These orders fit: about ${money(total)} of the ${money(capV)} allowed${localOnly ? '' : ', the designer included'}.`;
}
