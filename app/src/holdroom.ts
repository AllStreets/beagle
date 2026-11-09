// The hold: every specimen of the generation in a glass jar, filled to its score, its likely
// range etched on the glass. Beneath, the ledger; and the scales, which weigh any two specimens
// against each other item by item, the way a careful reader would before calling one better.
import { api, entrants, pct, type Entrant } from './data.ts';
import { esc, money, secs, term, head } from './ui.ts';
import { bootstrap, mean } from '../../src/stats.ts';
import type { Ctx } from './rooms.ts';

type Run = { id: string; task: string; score: number; status: string };
const CASLON = '"Libre Caslon Text", "EB Garamond", serif';

export function holdRoom(el: HTMLElement, c: Ctx) {
  const es = entrants(c.gen), lead = es.find(e => !e.control)!, best = es.filter(e => e.control).sort((a, b) => b.mean - a.mean)[0];
  const sep = lead && best ? lead.lo > best.hi : false;
  el.innerHTML = `<div class="hold">${head('The hold', `All ${es.length} specimens of generation ${c.genN + 1}, each in its jar, filled to its score. Each was tried on the same ${c.gen.common} news items. Choose two jars to weigh them against each other.`)}
  <div class="shelf-wrap"><canvas id="shelf" role="img" aria-label="A shelf of specimen jars, each filled to its agent's score"></canvas><div class="jar-hits"></div></div>
  <p class="verdict">${lead ? `${esc(lead.name)} leads with ${pct(lead.mean)}. ${best ? (sep ? `It clearly beats the best ${term('control')}, ${esc(best.name)} (${pct(best.mean)}): their ranges do not overlap.` : `It is not yet clearly better than the best ${term('control')}, ${esc(best.name)} (${pct(best.mean)}): their ranges overlap.`) : ''}` : ''}</p>

  <section class="scales" id="scales">
    <h2>The scales</h2>
    <p class="soft">Two scores whose ranges overlap may still differ, if one agent wins on most of the same items. The scales pair the two agents item by item and ask how big the difference is, and how sure.</p>
    <div class="pans">
      <label><span>Left pan</span><select id="pa">${es.map((e, i) => `<option value="${esc(e.genome)}" ${i === 0 ? 'selected' : ''}>${esc(e.name)} (${pct(e.mean)})</option>`).join('')}</select></label>
      <label><span>Right pan</span><select id="pb">${es.map((e, i) => `<option value="${esc(e.genome)}" ${i === 1 ? 'selected' : ''}>${esc(e.name)} (${pct(e.mean)})</option>`).join('')}</select></label>
    </div>
    <div class="weighing"><canvas id="beam" aria-hidden="true"></canvas><canvas id="pairs" role="img" aria-label="Each news item as a dot: the left agent's score across, the right agent's up"></canvas><div id="weigh-out"></div></div>
  </section>

  <table class="ledger"><thead><tr><th>Specimen</th><th>Score</th><th>${term('interval', 'Likely range')}</th><th>Within 25 km</th>${c.view === 'lab' ? `<th>Cost</th><th>Time per item</th><th>${term('front', 'Front')}</th><th>Answered</th>` : ''}</tr></thead><tbody>${es.map(e => `<tr class="${e.control ? 'ctl' : ''}"><td><a href="#/drawing/${encodeURIComponent(e.genome)}">${esc(e.name)}</a>${e.control ? ' <small>control</small>' : ''}</td><td class="n"><span class="fill" style="--w:${e.mean}"></span>${pct(e.mean)}</td><td class="n">${pct(e.lo)} to ${pct(e.hi)}</td><td class="n">${e.within} of ${e.tasks}</td>${c.view === 'lab' ? `<td class="n">${money(e.usd)}</td><td class="n">${secs(e.ms)}</td><td class="n">${e.pareto}</td><td class="n">${e.tasks - e.noAnswer} of ${e.tasks}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;

  const pa = el.querySelector<HTMLSelectElement>('#pa')!, pb = el.querySelector<HTMLSelectElement>('#pb')!;
  let picks: string[] = [pa.value, pb.value];
  const shelf = () => drawShelf(el, es, picks, g => { picks = [picks[1], g]; pa.value = picks[0]; pb.value = picks[1]; shelf(); weigh(); });
  const weigh = () => weighTwo(el, c, es.find(e => e.genome === pa.value)!, es.find(e => e.genome === pb.value)!);
  pa.addEventListener('change', () => { picks = [pa.value, pb.value]; shelf(); weigh(); });
  pb.addEventListener('change', () => { picks = [pa.value, pb.value]; shelf(); weigh(); });
  document.fonts?.load(`20px ${CASLON}`).catch(() => null).finally(() => { shelf(); weigh(); });
}

// ---------- the shelf ----------
function drawShelf(el: HTMLElement, es: Entrant[], picks: string[], pick: (g: string) => void) {
  const cv = el.querySelector<HTMLCanvasElement>('#shelf')!, hits = el.querySelector<HTMLElement>('.jar-hits')!;
  const W = cv.parentElement!.clientWidth, jarW = Math.max(62, Math.min(96, (W - 20) / es.length - 10)), gap = 10, H = jarW * 2.3 + 84;
  const total = es.length * (jarW + gap) + 20, dpr = Math.min(2, devicePixelRatio);
  cv.style.width = `${total}px`; cv.style.height = `${H}px`; cv.width = total * dpr; cv.height = H * dpr;
  const k = cv.getContext('2d')!; k.setTransform(dpr, 0, 0, dpr, 0, 0);
  // the shelf board and the wall behind
  let g = k.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#e9e0c8'); g.addColorStop(1, '#ddd2b4'); k.fillStyle = g; k.fillRect(0, 0, total, H);
  const shelfY = H - 40;
  g = k.createLinearGradient(0, shelfY, 0, H); g.addColorStop(0, '#7a5534'); g.addColorStop(.2, '#5e3f25'); g.addColorStop(1, '#3d2816'); k.fillStyle = g; k.fillRect(0, shelfY, total, H - shelfY);
  k.fillStyle = 'rgba(255,220,170,.25)'; k.fillRect(0, shelfY, total, 2);
  hits.innerHTML = '';
  es.forEach((e, i) => {
    const x = 10 + i * (jarW + gap), top = 26, bodyTop = top + 22, bot = shelfY - 2, bodyH = bot - bodyTop, chosen = picks.indexOf(e.genome);
    // shadow on the shelf
    k.fillStyle = 'rgba(20,10,0,.35)'; k.beginPath(); k.ellipse(x + jarW / 2 + 4, bot + 2, jarW / 2, 5, 0, 0, 7); k.fill();
    // the liquid: amber for agents, a paler water for controls, to its score
    const level = bot - 4 - (bodyH - 10) * e.mean;
    g = k.createLinearGradient(x, 0, x + jarW, 0);
    const [c0, c1] = e.control ? ['rgba(170,175,160,.55)', 'rgba(120,128,110,.6)'] : ['rgba(214,150,58,.85)', 'rgba(150,88,26,.9)'];
    g.addColorStop(0, c1); g.addColorStop(.35, c0); g.addColorStop(1, c1);
    k.fillStyle = g; k.beginPath(); k.roundRect(x + 4, level, jarW - 8, bot - 4 - level, [0, 0, 8, 8]); k.fill();
    k.fillStyle = 'rgba(255,230,180,.35)'; k.fillRect(x + 4, level, jarW - 8, 2);
    // the likely range, etched on the glass as a bracket of graduations
    const yLo = bot - 4 - (bodyH - 10) * e.lo, yHi = bot - 4 - (bodyH - 10) * e.hi;
    k.strokeStyle = 'rgba(40,30,20,.7)'; k.lineWidth = 1; k.beginPath(); k.moveTo(x + jarW - 9, yHi); k.lineTo(x + jarW - 13, yHi); k.lineTo(x + jarW - 13, yLo); k.lineTo(x + jarW - 9, yLo); k.stroke();
    for (let t = 0; t <= 10; t++) { const y = bot - 4 - (bodyH - 10) * t / 10; k.beginPath(); k.moveTo(x + 5, y); k.lineTo(x + (t % 5 ? 9 : 13), y); k.stroke(); }
    // the glass: outline, and two highlights
    k.strokeStyle = chosen >= 0 ? '#8f2a1c' : 'rgba(60,50,40,.55)'; k.lineWidth = chosen >= 0 ? 2.4 : 1.4;
    k.beginPath(); k.roundRect(x + 2, bodyTop, jarW - 4, bodyH, [6, 6, 10, 10]); k.stroke();
    k.fillStyle = 'rgba(255,255,255,.35)'; k.fillRect(x + 7, bodyTop + 8, 3, bodyH - 20); k.fillStyle = 'rgba(255,255,255,.15)'; k.fillRect(x + jarW - 18, bodyTop + 10, 2, bodyH * .5);
    // the cork and its rim
    g = k.createLinearGradient(0, top, 0, bodyTop); g.addColorStop(0, '#b98d5c'); g.addColorStop(1, '#8a6238'); k.fillStyle = g; k.beginPath(); k.roundRect(x + 8, top, jarW - 16, 22, 3); k.fill();
    k.fillStyle = 'rgba(60,40,20,.25)'; for (let d = 0; d < 14; d++) { k.fillRect(x + 10 + ((d * 37) % (jarW - 22)), top + 3 + ((d * 13) % 16), 2, 2); }
    // the label: a paper tag pinned to the shelf's edge, so the glass stays clear
    const ty = shelfY + 5, tw = jarW - 14;
    k.fillStyle = '#f5efdf'; k.fillRect(x + 7, ty, tw, 24); k.strokeStyle = 'rgba(60,40,20,.55)'; k.lineWidth = .7; k.strokeRect(x + 9, ty + 2, tw - 4, 20);
    k.fillStyle = '#7a5a2a'; k.beginPath(); k.arc(x + jarW / 2, ty + 3, 1.8, 0, 7); k.fill();
    k.fillStyle = '#241c14'; k.textAlign = 'center'; k.font = `700 ${Math.round(Math.min(16, jarW * .2))}px ${CASLON}`; k.fillText(String(pct(e.mean)), x + jarW / 2 - (e.control ? 0 : 0), ty + 18);
    k.font = `italic 10px ${CASLON}`; k.fillStyle = '#4b3f30'; k.textAlign = 'left'; k.fillText(String(i + 1), x + 11, ty + 11);
    if (chosen >= 0) { k.font = `700 12px ${CASLON}`; k.fillStyle = '#8f2a1c'; k.fillText(chosen ? 'RIGHT' : 'LEFT', x + jarW / 2, top - 8); }
    const b = document.createElement('button'); b.className = 'jar-hit'; b.style.cssText = `left:${x}px;width:${jarW}px;height:${H}px`;
    b.title = `${e.name}: ${pct(e.mean)}, likely ${pct(e.lo)} to ${pct(e.hi)}`; b.setAttribute('aria-label', `${e.name}, ${pct(e.mean)}. Put on the scales.`);
    b.addEventListener('click', () => pick(e.genome)); hits.appendChild(b);
  });
}

// ---------- the scales ----------
async function weighTwo(el: HTMLElement, c: Ctx, A: Entrant, B: Entrant) {
  const out = el.querySelector<HTMLElement>('#weigh-out')!;
  const [ra, rb] = await Promise.all([A, B].map(e => api<Run[]>(`/voyages/${c.voyage.id}/runs?generation=${c.genN}&genome=${encodeURIComponent(e.genome)}`, [])));
  const mb = new Map(rb.map(r => [r.task, r.score])), pairs = ra.filter(r => mb.has(r.task)).map(r => ({ a: r.score, b: mb.get(r.task)! }));
  if (!pairs.length) { out.innerHTML = '<p class="soft">These two share no items.</p>'; return; }
  const d = pairs.map(p => p.b - p.a), diff = mean(d), ci = bootstrap(d, c.voyage.settings.seed);
  const wins = pairs.filter(p => p.b > p.a + .005).length, losses = pairs.filter(p => p.a > p.b + .005).length, ties = pairs.length - wins - losses;
  const clear = ci.lo > 0 || ci.hi < 0, heavier = diff > 0 ? B : A;
  drawBeam(el.querySelector<HTMLCanvasElement>('#beam')!, A, B, diff);
  drawPairs(el.querySelector<HTMLCanvasElement>('#pairs')!, pairs, A.name, B.name);
  const f = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1)}`;
  out.innerHTML = `<p class="weigh-verdict">${A.genome === B.genome ? 'The same specimen on both pans.' : clear
    ? `<b>${esc(heavier.name)}</b> is clearly heavier: ${f(Math.abs(diff))} points on the same items, likely between ${f(diff > 0 ? ci.lo : -ci.hi)} and ${f(diff > 0 ? ci.hi : -ci.lo)}.`
    : `Too close to call. The right pan is ${f(diff)} points on the same items, but the likely difference runs from ${f(ci.lo)} to ${f(ci.hi)}, a range that includes no difference at all.`}</p>
    <dl class="weigh-nums"><div><dt>Items in common</dt><dd>${pairs.length}</dd></div><div><dt>Right pan better</dt><dd>${wins}</dd></div><div><dt>Left pan better</dt><dd>${losses}</dd></div><div><dt>Level</dt><dd>${ties}</dd></div><div><dt>Right pan minus left</dt><dd>${f(diff)}</dd></div><div><dt>Likely range</dt><dd>${f(ci.lo)} to ${f(ci.hi)}</dd></div></dl>
    <p class="soft">A paired bootstrap: the ${pairs.length} item-by-item differences are resampled 10,000 times with the voyage's seed. An item counts as level when the two scored the same on it.</p>`;
}

function drawBeam(cv: HTMLCanvasElement, A: Entrant, B: Entrant, diff: number) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio), W = r.width, H = r.height; cv.width = W * dpr; cv.height = H * dpr;
  const k = cv.getContext('2d')!; k.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = W / 2, py = 40, arm = Math.min(W * .36, 200), tilt = Math.max(-.22, Math.min(.22, diff * 1.6));   // heavier side goes down
  // the post and base, brass
  const brass = (x0: number, y0: number, x1: number, y1: number) => { const g = k.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, '#8a6630'); g.addColorStop(.5, '#e2c07a'); g.addColorStop(1, '#8a6630'); return g; };
  k.fillStyle = brass(cx - 5, 0, cx + 5, 0); k.fillRect(cx - 4, py, 8, H - py - 22);
  k.fillStyle = brass(cx - 60, 0, cx + 60, 0); k.beginPath(); k.ellipse(cx, H - 16, 62, 9, 0, 0, 7); k.fill();
  k.save(); k.translate(cx, py); k.rotate(tilt);
  k.fillStyle = brass(-arm, 0, arm, 0); k.fillRect(-arm, -3, arm * 2, 6);
  k.beginPath(); k.moveTo(0, -18); k.lineTo(6, 0); k.lineTo(-6, 0); k.closePath(); k.fill();
  k.restore();
  const end = (s: number) => ({ x: cx + Math.cos(tilt) * arm * s, y: py + Math.sin(tilt) * arm * s });
  for (const [s, e] of [[-1, A], [1, B]] as const) {
    const p = end(s), panY = p.y + 64;
    k.strokeStyle = '#7a5a2a'; k.lineWidth = 1; k.beginPath(); k.moveTo(p.x, p.y); k.lineTo(p.x - 34, panY); k.moveTo(p.x, p.y); k.lineTo(p.x + 34, panY); k.stroke();
    k.fillStyle = brass(p.x - 40, 0, p.x + 40, 0); k.beginPath(); k.ellipse(p.x, panY, 42, 8, 0, 0, Math.PI); k.fill();
    k.fillStyle = '#241c14'; k.textAlign = 'center'; k.font = `700 20px ${CASLON}`; k.fillText(String(pct(e.mean)), p.x, panY + 30);
    k.font = `italic 12.5px ${CASLON}`; k.fillStyle = '#4b3f30';
    const name = e.name.length > 24 ? e.name.slice(0, 23) + '…' : e.name, w = k.measureText(name).width;
    k.fillText(name, Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, p.x)), panY + 48);
  }
}

function drawPairs(cv: HTMLCanvasElement, pairs: { a: number; b: number }[], an: string, bn: string) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio), W = r.width, H = r.height; cv.width = W * dpr; cv.height = H * dpr;
  const k = cv.getContext('2d')!; k.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = 46, T = 14, S = Math.min(W - L - 16, H - T - 44), X = (v: number) => L + v * S, Y = (v: number) => T + S - v * S;
  k.fillStyle = '#f4eedd'; k.fillRect(L, T, S, S);
  // above the diagonal the right pan won the item, below it the left
  k.fillStyle = 'rgba(143,42,28,.06)'; k.beginPath(); k.moveTo(L, T + S); k.lineTo(L, T); k.lineTo(L + S, T); k.closePath(); k.fill();
  k.strokeStyle = 'rgba(36,28,20,.15)'; k.lineWidth = 1; for (let v = 0; v <= 1.001; v += .25) { k.beginPath(); k.moveTo(X(v), T); k.lineTo(X(v), T + S); k.moveTo(L, Y(v)); k.lineTo(L + S, Y(v)); k.stroke(); }
  k.strokeStyle = 'rgba(36,28,20,.6)'; k.setLineDash([5, 4]); k.beginPath(); k.moveTo(X(0), Y(0)); k.lineTo(X(1), Y(1)); k.stroke(); k.setLineDash([]);
  k.strokeStyle = '#241c14'; k.strokeRect(L, T, S, S);
  // stacked dots where items land on the same point
  const seen = new Map<string, number>();
  for (const p of pairs) { const key = `${Math.round(p.a * 50)},${Math.round(p.b * 50)}`, n = seen.get(key) ?? 0; seen.set(key, n + 1);
    const x = X(p.a) + (n ? Math.cos(n * 2.4) * 5 : 0), y = Y(p.b) + (n ? Math.sin(n * 2.4) * 5 : 0);
    k.beginPath(); k.arc(x, y, 4.2, 0, 7); k.fillStyle = p.b > p.a + .005 ? '#8f2a1c' : p.a > p.b + .005 ? '#241c14' : '#f4eedd'; k.fill(); k.strokeStyle = '#241c14'; k.lineWidth = .8; k.stroke(); }
  k.fillStyle = '#4b3f30'; k.font = `italic 12.5px ${CASLON}`; k.textAlign = 'center';
  k.fillText(`left pan's score on each item →`, L + S / 2, T + S + 32);
  k.save(); k.translate(14, T + S / 2); k.rotate(-Math.PI / 2); k.fillText(`right pan's score →`, 0, 0); k.restore();
  k.font = `11px ${CASLON}`; for (const v of [0, .5, 1]) { k.fillText(String(v * 100), X(v), T + S + 15); k.textAlign = 'right'; k.fillText(String(v * 100), L - 6, Y(v) + 4); k.textAlign = 'center'; }
  k.textAlign = 'left'; k.font = `italic 12px ${CASLON}`; k.fillStyle = '#8f2a1c'; k.fillText('right pan better', L + 8, T + 18); k.fillStyle = '#241c14'; k.textAlign = 'right'; k.fillText('left pan better', L + S - 8, T + S - 10);
}
