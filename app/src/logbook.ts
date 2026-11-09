// The log: a printed logbook form, filled in by hand. Its two instruments are real checks:
// the seal recomputes the sealed test's fingerprint now and compares it with the one written at
// launch, and the tally re-grades every answer of the voyage in this browser, from coordinates
// alone, with the same grader and the same seeded intervals, then compares with the record.
import { api, post } from './data.ts';
import { esc, money, term } from './ui.ts';
import { grade as gradePoint, type Truth } from '../../src/arenas/geotag/grade.ts';
import { gradeReceipt, type Receipt } from '../../src/arenas/receipts/grade.ts';

// the graders that run in a browser; any other arena is re-graded by the server on this Mac
const GRADERS: Record<string, (a: unknown, t: any) => number> = { geotag: (a, t) => gradePoint(a, t as Truth), receipts: (a, t) => gradeReceipt(a, t as Receipt) };
import { bootstrap, mean } from '../../src/stats.ts';
import type { Ctx } from './rooms.ts';

type Run = { generation: number; genome: string; task: string; answer: unknown; score: number; status: string };
type Bundle = { voyage: { settings: { seed?: number } }; tasks: Record<string, { truth: Truth }>; runs: Run[] };
type Seal = { recorded: string; now: string; match: boolean; items: number; at: string };

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const clock = (d = new Date()) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const n = (x: number) => x.toLocaleString('en-GB');

export function logbook(el: HTMLElement, c: Ctx) {
  const v = c.voyage, a = c.arena, gens = v.generations.filter(g => g.generation >= 0);
  const kept = gens.reduce((s, g) => s + g.usd, 0), extra = v.spent - kept;
  const sealedFrom = a?.info?.version.split('; sealed from ')[1]?.split(';')[0];
  el.innerHTML = `<div class="logbook">
  <header class="lb-head">
    <p class="pr caps">H.M.S. Beagle &nbsp;·&nbsp; Log of the voyage</p>
    <h1 class="lb-title">The Log</h1>
    <dl class="lb-meta">
      <div><dt class="pr">Voyage No.</dt><dd class="hand">${esc(v.id.replace(/^v-\d{4}-\d{2}-\d{2}-/, ''))}</dd></div>
      <div><dt class="pr">Sailed</dt><dd class="hand">${esc(longDate(v.started_at))}</dd></div>
      <div><dt class="pr">Arena</dt><dd class="hand">${esc(a?.name ?? v.arena)}</dd></div>
      <div><dt class="pr">Generations</dt><dd class="hand">${gens.length}</dd></div>
    </dl>
    <p class="lb-lede">What was fixed before the voyage, what it cost, and two ways to check its numbers without trusting Beagle.</p>
  </header>

  <section class="lb-page lb-seal">
    <canvas id="seal" width="520" height="520" role="img" aria-label="A red wax seal pressed with the sealed test's fingerprint"></canvas>
    <div>
      <h2 class="pr caps">I. Sealed before sailing</h2>
      <p>${a ? `${n(a.counts.sealed)} ${a.kind === 'geotag' ? 'news items' : a.kind === 'receipts' ? 'receipts' : a.kind === 'fixtest' ? 'bugs' : 'items'}${sealedFrom ? ` from ${esc(sealedFrom)} on` : ''}` : 'The sealed items'} were set aside as the ${term('sealed', 'sealed test')} before the first race. Their fingerprint, pressed into the seal, was written into this log at launch. No agent and no designer has seen them.</p>
      <p>To test the seal, Beagle reads the sealed items again now and computes their fingerprint afresh. If a single item had changed, the two would differ.</p>
      <button class="lb-btn" id="test-seal">Test the seal</button>
      <div class="lb-hashes" id="hashes" hidden>
        <div><span class="pr">Written at launch</span><code id="h-rec"></code></div>
        <div><span class="pr">Computed just now</span><code id="h-now"></code></div>
        <p class="hand verdict-hand" id="seal-verdict"></p>
      </div>
    </div>
  </section>

  <section class="lb-page lb-check">
    <h2 class="pr caps">II. Every score, worked again by hand</h2>
    ${GRADERS[a?.kind ?? 'geotag'] ? `<p>Your browser fetches the whole voyage as one file: every item with its truth, every agent's answer. It then grades every answer again from the answers alone, with no model calls and no help from Beagle's server, and works each agent's score and likely range again. Each stroke below is ten answers checked.</p>
    <button class="lb-btn" id="regrade">Re-grade the voyage in this browser</button>` : `<p>This arena's grader ${a?.kind === 'fixtest' ? 'runs the library\'s whole test suite on every mend' : 'is code the arena\'s author wrote'}, so it cannot run in a browser. Beagle's server re-grades every answer on this Mac instead, from the voyage file alone and with no model calls, and works each agent's score and likely range again.</p>
    <button class="lb-btn" id="regrade">Re-grade the voyage on this Mac</button>`}
    <table class="lb-form" id="tally-table">
      <thead><tr><th class="pr">Gen.</th><th class="pr">Answers</th><th class="pr tally-col">Tally</th><th class="pr">Agree</th><th class="pr">Best, as recorded</th><th class="pr">Best, worked again</th></tr></thead>
      <tbody>${gens.map(g => `<tr data-g="${g.generation}"><td class="hand">${g.generation + 1}</td><td class="num hand">${n(g.runs)}</td><td class="tally-col"><canvas class="tally" width="900" height="64"></canvas></td><td class="num hand agree"></td><td class="num rec"></td><td class="num hand again"></td></tr>`).join('')}</tbody>
    </table>
    <p class="hand verdict-hand" id="regrade-verdict"></p>
    <p class="soft">The same check from a terminal: <code>beagle export ${esc(v.id)}</code> then <code>beagle regrade</code> on the file it writes. Or <a href="/api/voyages/${encodeURIComponent(v.id)}/bundle" download="${esc(v.id)}.beagle.json">take the file</a> and grade it with anything you like: a score is 100 within 25 km of the nearest true place, falling with the logarithm of the distance to 0 at 2,500 km.</p>
  </section>

  <section class="lb-page lb-spent">
    <h2 class="pr caps">III. Account of expenses</h2>
    <table class="lb-form">
      <thead><tr><th class="pr">Gen.</th><th class="pr">Runs</th><th class="pr">Paid</th><th class="pr">Of the cap</th></tr></thead>
      <tbody>${gens.map(g => `<tr><td class="hand">${g.generation + 1}</td><td class="num hand">${n(g.runs)}</td><td class="num hand">${money(g.usd)}</td><td><span class="rule"><i style="--w:${Math.min(1, g.usd / v.settings.capGeneration)}"></i></span> <small>of ${money(v.settings.capGeneration)}</small></td></tr>`).join('')}
      ${extra > .005 ? `<tr><td></td><td class="pr">Paid for, not kept</td><td class="num hand">${money(extra)}</td><td><small>runs redone after a fault, and runs a second race process paid for twice on 8 November before Beagle learned to stop that</small></td></tr>` : ''}
      <tr class="sum"><td></td><td class="pr">The voyage</td><td class="num hand">${money(v.spent)}</td><td><span class="rule"><i style="--w:${Math.min(1, v.spent / v.settings.capVoyage)}"></i></span> <small>of ${money(v.settings.capVoyage)}</small></td></tr></tbody>
    </table>
    <p class="soft">Every call paid for is in the ledger, including runs later thrown away. Claude calls count at the cost Claude Code reports; models on this Mac count as free.</p>
  </section>

  <section class="lb-page lb-particulars">
    <h2 class="pr caps">IV. Particulars</h2>
    <dl class="lb-fields">
      <div><dt class="pr">The arena</dt><dd>${a ? `${esc(a.name)}: ${n(a.counts.breeding ?? 0)} items to learn from, ${n(a.counts.race ?? 0)} to race on, ${n(a.counts.sealed ?? 0)} sealed${a.counts.pool ? `, ${n(a.counts.pool)} unlabelled for fossils` : ''}. ${({ geotag: 'From Wikipedia\'s Current Events, with each place\'s coordinates from Wikidata.', receipts: 'From CORD v2 (CC BY 4.0): its training receipts to learn from, its validation receipts to race on, its test receipts sealed.', fixtest: 'One-line bugs planted in beaglelib, a frozen copy of Beagle\'s own code with 109 tests; split by the function each bug is in, so no function is in two splits.', custom: 'An arena of your own: its tasks split by a hash of each id.' } as Record<string, string>)[a.kind] ?? ''}` : ''}</dd></div>
      ${a?.info ? `<div><dt class="pr">Built</dt><dd><span class="hand">${esc(longDate(a.info.built_at))}</span>, fingerprint <code>${esc(a.info.hash.slice(0, 16))}</code></dd></div>` : ''}
      <div><dt class="pr">Controls</dt><dd>${(() => { const ctl = c.gen.scores.filter(s => s.genome.startsWith('baseline:')).map(s => s.genome.slice(9)); return ctl.length ? `${ctl.map((x, i) => i === ctl.length - 1 && i ? `and ${esc(x)}` : esc(x)).join(ctl.length > 2 ? ', ' : ' ')}, each shown the item exactly as the agents see it.` : 'None raced in this generation.'; })()} Every generation races them on the same items: a score only means something next to theirs.</dd></div>
      <div><dt class="pr">Seed</dt><dd><span class="hand">${v.settings.seed}</span>, which fixes the items drawn and every range, so the voyage can be worked again.</dd></div>
    </dl>
  </section>

  ${c.others?.length ? `<section class="lb-page lb-withdrawn">
    <h2 class="pr caps">V. Voyages withdrawn</h2>
    <ol>${c.others.map(o => `<li><span class="struck">${esc(o.id)}, ${money(o.spent)}</span><span class="margin hand">${esc(o.note ?? 'withdrawn')}</span></li>`).join('')}</ol>
    <p class="soft">Struck out, not torn out: their spend stays in the ledger, and their results are not compared with this voyage.</p>
  </section>` : ''}

  ${a?.kind === 'geotag' ? `<section class="lb-page lb-remarks">
    <h2 class="pr caps">Remarks</h2>
    <p>In the second voyage, two answers matched the truth's Wikidata coordinate to six decimal places. The run's full record shows no access to it: Sonnet planned, looked up two villages the gazetteer did not have, and answered from memory. It had memorised the coordinate Wikipedia shows for southern Lebanon. That is knowledge the model brings, not a leak, and it is reported here rather than hidden.</p>
  </section>` : ''}
  </div>`;

  drawSeal(el.querySelector<HTMLCanvasElement>('#seal')!, v.sealed_hash);
  el.querySelector('#test-seal')!.addEventListener('click', e => testSeal(el, v.id, e.currentTarget as HTMLButtonElement));
  el.querySelector('#regrade')!.addEventListener('click', e => regrade(el, v.id, c, e.currentTarget as HTMLButtonElement));
}

// ---------- the seal: red wax, pressed with the fingerprint around its rim ----------
function drawSeal(cv: HTMLCanvasElement, hash: string) {
  const k = cv.getContext('2d')!, W = cv.width, cx = W / 2, cy = W / 2, R = 200;
  let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  // the poured wax: an uneven blob, darker at its edge, with a soft cast shadow
  const blob: [number, number][] = [];
  for (let i = 0; i < 90; i++) { const t = i / 90 * Math.PI * 2, rr = R + Math.sin(t * 3 + 1) * 7 + Math.sin(t * 7) * 4 + (r() - .5) * 6; blob.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr]); }
  const path = () => { k.beginPath(); blob.forEach(([x, y], i) => i ? k.lineTo(x, y) : k.moveTo(x, y)); k.closePath(); };
  k.save(); path(); k.shadowColor = 'rgba(40,10,4,.55)'; k.shadowBlur = 26; k.shadowOffsetY = 10; k.fillStyle = '#6e140c'; k.fill(); k.restore();
  let g = k.createRadialGradient(cx - 50, cy - 60, 20, cx, cy, R + 10); g.addColorStop(0, '#b0301f'); g.addColorStop(.55, '#8a1d12'); g.addColorStop(1, '#4e0b06');
  path(); k.fillStyle = g; k.fill();
  // the pressed face: a sunken disc with a raised rim
  const ring = (rad: number, w: number, light: string, dark: string) => { k.lineWidth = w; k.strokeStyle = dark; k.beginPath(); k.arc(cx + 1.5, cy + 2, rad, 0, Math.PI * 2); k.stroke(); k.strokeStyle = light; k.beginPath(); k.arc(cx - 1, cy - 1.5, rad, 0, Math.PI * 2); k.stroke(); };
  g = k.createRadialGradient(cx + 30, cy + 40, 10, cx, cy, 168); g.addColorStop(0, '#7c170d'); g.addColorStop(1, '#5c0f08');
  k.beginPath(); k.arc(cx, cy, 166, 0, Math.PI * 2); k.fillStyle = g; k.fill();
  ring(166, 3, 'rgba(255,170,140,.35)', 'rgba(30,4,2,.6)'); ring(118, 2, 'rgba(30,4,2,.55)', 'rgba(255,170,140,.3)');
  // the fingerprint, embossed around the rim in two passes of 32 characters
  k.textAlign = 'center'; k.textBaseline = 'middle';
  const emboss = (t: string, x: number, y: number, rot: number, font: string) => { k.save(); k.translate(x, y); k.rotate(rot); k.font = font; k.fillStyle = 'rgba(25,3,1,.65)'; k.fillText(t, 1.2, 1.6); k.fillStyle = 'rgba(255,190,160,.55)'; k.fillText(t, -.6, -.8); k.restore(); };
  [hash.slice(0, 32), hash.slice(32)].forEach((half, row) => {
    const rad = row ? 128 : 150;
    [...half].forEach((ch, i) => { const t = -Math.PI / 2 + (i + .5) / half.length * Math.PI * 2; emboss(ch.toUpperCase(), cx + Math.cos(t) * rad, cy + Math.sin(t) * rad, t + Math.PI / 2, `${row ? 15 : 17}px "IM Fell DW Pica"`); });
  });
  // the device in the middle: an anchor, and the ship's initial
  k.save(); k.translate(cx, cy);
  k.strokeStyle = 'rgba(25,3,1,.6)'; k.lineWidth = 5; k.lineCap = 'round';
  const anchor = (dx: number, dy: number) => { k.beginPath(); k.moveTo(dx, -62 + dy); k.lineTo(dx, 62 + dy); k.moveTo(-28 + dx, -40 + dy); k.lineTo(28 + dx, -40 + dy); k.moveTo(-54 + dx, 30 + dy); k.quadraticCurveTo(dx, 96 + dy, 54 + dx, 30 + dy); k.stroke(); k.beginPath(); k.arc(dx, -74 + dy, 11, 0, Math.PI * 2); k.stroke(); };
  anchor(1.4, 1.8); k.strokeStyle = 'rgba(255,180,150,.45)'; k.lineWidth = 3.4; anchor(-.6, -.8);
  k.restore();
  emboss('B', cx, cy + 4, 0, '600 64px "IM Fell English SC"');
  // a few glints where the wax caught the light
  k.save(); path(); k.clip(); g = k.createRadialGradient(cx - 90, cy - 110, 0, cx - 90, cy - 110, 90); g.addColorStop(0, 'rgba(255,220,200,.35)'); g.addColorStop(1, 'rgba(255,220,200,0)'); k.fillStyle = g; k.fillRect(0, 0, W, W); k.restore();
}

async function testSeal(el: HTMLElement, id: string, btn: HTMLButtonElement) {
  btn.disabled = true; btn.textContent = 'Reading the sealed items...';
  const box = el.querySelector<HTMLElement>('#hashes')!, rec = el.querySelector('#h-rec')!, now = el.querySelector('#h-now')!, out = el.querySelector('#seal-verdict')!;
  let s: Seal;
  try { s = await api<Seal>(`/voyages/${encodeURIComponent(id)}/seal`); } catch { btn.disabled = false; btn.textContent = 'Test the seal'; out.textContent = 'The seal could not be read: is the server running?'; box.hidden = false; return; }
  box.hidden = false; rec.textContent = s.recorded; now.textContent = '';
  // the fresh fingerprint is written out one character at a time against the recorded one
  for (let i = 0; i < s.now.length; i++) {
    const span = document.createElement('span'); span.textContent = s.now[i]; span.className = s.now[i] === s.recorded[i] ? 'ok' : 'bad'; now.appendChild(span);
    await new Promise(r => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 14));
  }
  out.textContent = s.match ? `The seal holds: all 64 characters agree, over ${n(s.items)} sealed items. Tested ${clock()}, ${longDate(s.at)}.` : `The seal is broken: the sealed items have changed since launch. Tested ${clock()}.`;
  out.classList.toggle('bad', !s.match);
  btn.textContent = 'Test it again'; btn.disabled = false;
}

// ---------- the tally: every answer graded again, ten to a stroke ----------
async function regrade(el: HTMLElement, id: string, c: Ctx, btn: HTMLButtonElement) {
  const grade = GRADERS[c.arena?.kind ?? 'geotag'];
  if (!grade) return regradeOnMac(el, id, c, btn);
  btn.disabled = true; btn.textContent = 'Fetching the voyage...';
  const out = el.querySelector<HTMLElement>('#regrade-verdict')!;
  let b: Bundle;
  try { b = await api<Bundle>(`/voyages/${encodeURIComponent(id)}/bundle`); } catch { btn.disabled = false; btn.textContent = 'Re-grade the voyage in this browser'; out.textContent = 'The voyage file could not be fetched.'; return; }
  btn.textContent = 'Grading...';
  const t0 = performance.now(), seed = b.voyage.settings.seed ?? 1, fast = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let all = 0, agreeAll = 0, missing = 0;
  for (const g of c.voyage.generations.filter(x => x.generation >= 0)) {
    const row = el.querySelector<HTMLTableRowElement>(`tr[data-g="${g.generation}"]`)!, runs = b.runs.filter(r => r.generation === g.generation);
    const cv = row.querySelector<HTMLCanvasElement>('canvas.tally')!, k = cv.getContext('2d')!;
    let agree = 0; const again: Run[] = [];
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i], task = b.tasks[r.task];
      const score = task ? (r.status === 'done' ? grade(r.answer, task.truth) : 0) : NaN;
      if (!task) missing++;
      if (Math.abs(score - r.score) < 1e-9) agree++;
      again.push({ ...r, score: isNaN(score) ? 0 : score });
      if ((i + 1) % 10 === 0 || i === runs.length - 1) { stroke(k, Math.floor(i / 10), runs.length); if (!fast && Math.floor(i / 10) % 3 === 0) await new Promise(requestAnimationFrame); }
    }
    all += runs.length; agreeAll += agree;
    row.querySelector('.agree')!.textContent = agree === runs.length ? 'all' : `${n(agree)} of ${n(runs.length)}`;
    row.querySelector('.agree')!.classList.toggle('bad', agree !== runs.length);
    const best = (rs: Run[]) => {
      // the same rule as the race: only items every entrant finished, then a seeded bootstrap
      const genomes = [...new Set(rs.map(r => r.genome))], by = new Map(genomes.map(x => [x, new Map(rs.filter(r => r.genome === x).map(r => [r.task, r.score]))]));
      const common = [...new Set(rs.map(r => r.task))].filter(t => genomes.every(x => by.get(x)!.has(t))).sort();
      return genomes.filter(x => !x.startsWith('baseline:')).map(x => { const xs = common.map(t => by.get(x)!.get(t)!); return { genome: x, mean: mean(xs), ...bootstrap(xs, seed) }; }).sort((p, q) => q.mean - p.mean)[0];
    };
    const rec = best(runs), again1 = best(again), f = (s: { mean: number; lo: number; hi: number }) => `${(s.mean * 100).toFixed(1)} <small>(${(s.lo * 100).toFixed(1)} to ${(s.hi * 100).toFixed(1)})</small>`;
    row.querySelector('.rec')!.innerHTML = rec ? f(rec) : '';
    row.querySelector('.again')!.innerHTML = again1 ? f(again1) : '';
  }
  const ms = performance.now() - t0;
  out.classList.toggle('bad', agreeAll !== all);
  out.textContent = agreeAll === all
    ? `All ${n(all)} answers agree with the record, and so does every best score and its range. Worked again in this browser in ${(ms / 1000).toFixed(1)} s, ${clock()}.`
    : `${n(all - agreeAll)} of ${n(all)} answers do not agree with the record${missing ? ` (${n(missing)} have no item in the file)` : ''}. Worked ${clock()}.`;
  btn.textContent = 'Re-grade it again'; btn.disabled = false;
}

// four down strokes and a fifth across, in ink that varies a little, like a clerk's
function stroke(k: CanvasRenderingContext2D, i: number, total: number) {
  const gate = Math.floor(i / 5), j = i % 5, per = Math.max(1, Math.ceil(total / 10 / 5)), gw = Math.min(46, (k.canvas.width - 10) / per);
  const x0 = 6 + gate * gw, y0 = 12, y1 = 52, wob = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  k.strokeStyle = `rgba(28,22,16,${.75 + wob * .15})`; k.lineCap = 'round';
  if (j < 4) { const x = x0 + j * (gw - 12) / 4 + 3; k.lineWidth = 2.2; k.beginPath(); k.moveTo(x + wob * 2, y0 + wob * 3); k.lineTo(x - 1 - wob, y1); k.stroke(); }
  else { k.lineWidth = 2; k.beginPath(); k.moveTo(x0 - 2, y1 - 8); k.lineTo(x0 + gw - 10, y0 + 10 + wob * 4); k.stroke(); }
}

// the server re-grades it: every generation, every answer, from the exported voyage file
async function regradeOnMac(el: HTMLElement, id: string, c: Ctx, btn: HTMLButtonElement) {
  btn.disabled = true; btn.textContent = 'Running every grade again...';
  const out = el.querySelector<HTMLElement>('#regrade-verdict')!;
  const r = await post(`/voyages/${encodeURIComponent(id)}/regrade`).then(x => x.json()).catch(e => ({ error: String(e) }));
  if (r.error) { out.textContent = `The re-grade did not finish: ${r.error}`; btn.disabled = false; btn.textContent = 'Re-grade the voyage on this Mac'; return; }
  let all = 0, agree = 0;
  for (const g of r.generations as { generation: number; runs: number; agree: number; best: { recorded: any; again: any } }[]) {
    const row = el.querySelector<HTMLTableRowElement>(`tr[data-g="${g.generation}"]`); if (!row) continue;
    all += g.runs; agree += g.agree;
    const k = row.querySelector<HTMLCanvasElement>('canvas.tally')!.getContext('2d')!; for (let i = 0; i < Math.ceil(g.runs / 10); i++) stroke(k, i, g.runs);
    row.querySelector('.agree')!.textContent = g.agree === g.runs ? 'all' : `${n(g.agree)} of ${n(g.runs)}`;
    const f = (s: any) => s ? `${(s.mean * 100).toFixed(1)} <small>(${(s.lo * 100).toFixed(1)} to ${(s.hi * 100).toFixed(1)})</small>` : '';
    row.querySelector('.rec')!.innerHTML = f(g.best.recorded); row.querySelector('.again')!.innerHTML = f(g.best.again);
  }
  out.classList.toggle('bad', agree !== all);
  out.textContent = agree === all ? `All ${n(all)} answers agree with the record, and so does every best score and its range. Worked again on this Mac in ${(r.ms / 1000).toFixed(1)} s, ${clock()}.` : `${n(all - agree)} of ${n(all)} answers do not agree with the record. Worked ${clock()}.`;
  btn.textContent = 'Re-grade it again'; btn.disabled = false;
}
