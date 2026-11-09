// The fossil locker: a museum case. Each fossil is a slab under glass with its catalogue card,
// and can be asked about any news item: its few most likely places, in a fraction of a
// millisecond, set beside the agent it was taught by answering the same item.
import { post, pct, entrants, api } from './data.ts';
import { esc, money, secs, dist, term, head } from './ui.ts';
import { drawSheet, type Sheet } from './chartsheet.ts';
import { geoDistance } from 'd3-geo';
import type { Ctx } from './rooms.ts';

type Fossil = { voyage: string; genome: string; name: string; at: string; taught: number; breeding: number; items: number; cells: number; epochs: number; kept_epoch: number; train_seconds: number; ms_per_answer: number; bytes: number; embed_ms: number; teacher_ms: number; teacher_usd: number; curve: { held_out_loss: number }[]; race: { score: number; teacher: number; agreement: number; standsIn: boolean; items: number } };
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371;
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const plural = (n: number, w: string) => `${n.toLocaleString('en-GB')} ${w}${n === 1 ? '' : 's'}`;

export async function fossilRoom(el: HTMLElement, c: Ctx) {
  const fs = await api<Fossil[]>(`/voyages/${c.voyage.id}/fossils`, []), lead = entrants(c.gen).find(e => !e.control);
  if (!fs.length) {
    el.innerHTML = `<div class="museum">${head('The fossil locker', 'An empty case, for now.')}<div class="prose"><p>A ${term('fossil')} is what Beagle makes once an agent is good: the agent answers thousands of unlabelled news items, and a small network is trained on its answers here on this Mac, then checked honestly on the race items.</p><p>No skill has been fossilised yet. ${lead ? `The strongest candidate so far is ${esc(lead.name)}, at ${pct(lead.mean)}.` : ''}</p></div></div>`;
    return;
  }
  el.innerHTML = `<div class="museum">${head('The fossil locker', `${fs.length === 1 ? 'One skill has' : `${fs.length} skills have`} been pressed into a network that runs on this Mac. Each is catalogued as it measured, and can be asked about anything.`)}
  ${fs.map((f, i) => `
  <section class="exhibit">
    <div class="vitrine">
      <div class="case-glass"><canvas id="slab${i}" width="1200" height="720" role="img" aria-label="The training curve of ${esc(f.name)}'s fossil, cut into stone as strata"></canvas></div>
      <div class="brass-plate"><b>${esc(f.name)}</b><span>a skill in stone, ${esc(longDate(f.at))}</span></div>
      <p class="caption">The ridge is the network's error on items it never trained on, over ${f.curve.length} training passes, cut so that higher is better. The impression marks pass ${f.kept_epoch}, the one kept: after it the error rose again as the network began to memorise its teacher instead of learning from it.</p>
    </div>
    <article class="card">
      <header><span>Beagle collection</span><span>No. ${esc(f.voyage.slice(-6).toUpperCase())}-${String(i + 1).padStart(2, '0')}</span></header>
      <dl>
        <dt>Specimen</dt><dd>${esc(f.name)}, fossilised</dd>
        <dt>Taught by</dt><dd>${plural(f.taught, 'item')} its teacher answered${f.breeding ? `, and ${plural(f.breeding, 'practice item')} with true places` : ''}</dd>
        <dt>Trained</dt><dd>${f.train_seconds.toFixed(1)} s with MLX, ${f.curve.length} passes, kept pass ${f.kept_epoch}</dd>
        <dt>On the race</dt><dd>${pct(f.race.score)}, against its teacher's ${pct(f.race.teacher)}, on ${f.race.items} items</dd>
        <dt>Same region</dt><dd>${pct(f.race.agreement)}% of items, as its teacher</dd>
        <dt>Size</dt><dd>${(f.bytes / 1e6).toFixed(1)} MB, ${f.cells} places it can name</dd>
        <dt>Speed</dt><dd>${f.ms_per_answer.toFixed(2)} ms the network, ${Math.round(f.embed_ms)} ms reading the item</dd>
        <dt>Its teacher</dt><dd>${secs(f.teacher_ms)} an item, ${f.teacher_usd > 0 ? `${money(f.teacher_usd)} an item` : 'free (in Ollama)'}</dd>
      </dl>
      <div class="stamp ${f.race.standsIn ? 'yes' : 'no'}" aria-label="Verdict">${f.race.standsIn ? 'Stands in' : 'Does not stand in'}<small>${f.race.standsIn ? 'within 5 points of its teacher' : `${Math.round((f.race.teacher - f.race.score) * 100)} points behind its teacher`}</small></div>
    </article>
    <section class="ask-fossil" data-i="${i}">
      <h2>Ask it something</h2>
      <p>Write any news item. The fossil answers with the places it thinks most likely and how sure it is of each. Its teacher can answer the same item beside it${f.teacher_usd > 0 ? `, for about ${money(f.teacher_usd)}` : ', for free'}.</p>
      <form class="ask-form"><textarea name="text" rows="3" placeholder="Heavy snow closes the main road over the [place] pass, stranding hundreds of skiers in the resort town of [place].">Heavy snow closes the main road over the [place] pass, stranding hundreds of skiers in the resort town of [place].</textarea>
        <div class="row"><button type="submit" class="ask-btn">Ask the fossil</button><label><input type="checkbox" name="teacher" checked> and its teacher</label></div></form>
      <div class="answer-pair" hidden>
        <figure class="sheet"><canvas class="fossil-chart" role="img" aria-label="Where the fossil and its teacher answered"></canvas></figure>
        <div class="readout"></div>
      </div>
    </section>
  </section>`).join('')}</div>`;

  await document.fonts?.load('34px "IM Fell English SC"').catch(() => null);
  fs.forEach((f, i) => drawSlab(el.querySelector<HTMLCanvasElement>(`#slab${i}`)!, f, i, f.name));
  el.querySelectorAll<HTMLElement>('.ask-fossil').forEach(box => {
    const f = fs[Number(box.dataset.i)], form = box.querySelector('form')!;
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const text = String(new FormData(form).get('text') ?? '').trim(); if (!text) return;
      const withTeacher = form.querySelector<HTMLInputElement>('input[name=teacher]')!.checked, btn = form.querySelector('button')!;
      btn.disabled = true; btn.textContent = 'Asking...';
      const pair = box.querySelector<HTMLElement>('.answer-pair')!, out = box.querySelector<HTMLElement>('.readout')!;
      pair.hidden = false; out.innerHTML = '<p class="soft">The fossil is reading the item...</p>';
      const t0 = performance.now();
      const fr = await post('/fossils/ask', { voyage: f.voyage, genome: f.genome, text }).then(r => r.json()).catch(e => ({ error: String(e) }));
      const fWall = performance.now() - t0;
      if (fr.error) { out.innerHTML = `<p class="soft">${esc(fr.error)}</p>`; btn.disabled = false; btn.textContent = 'Ask the fossil'; return; }
      const top = fr.top as { lat: number; lon: number; p: number }[];
      const render = (teacher: { answer: { lat: number; lon: number } | null; ms: number; usd: number } | null, waiting: boolean) => {
        const sheet: Sheet = { wide: true, bare: true, title: 'Fossil and teacher', sub: `The fossil's five likeliest places, numbered by rank${teacher?.answer ? ', and its teacher\'s answer (T)' : ''}.`, truth: [],
          soundings: [...top.map((t, j) => ({ n: j + 1, name: `${Math.round(t.p * 100)}%`, control: j > 0, answer: t })), ...(teacher?.answer ? [{ n: 0, name: 'teacher', control: false, answer: teacher.answer, mark: 'T', red: true }] : [])] };
        drawSheet(box.querySelector<HTMLCanvasElement>('.fossil-chart')!, sheet);
        const agree = teacher?.answer ? km(teacher.answer, top[0]) : null;
        out.innerHTML = `<table class="duel"><thead><tr><th></th><th>The fossil</th><th>Its teacher</th></tr></thead><tbody>
          <tr><th>Answer</th><td>${top[0].lat.toFixed(2)}, ${top[0].lon.toFixed(2)} <small>${Math.round(top[0].p * 100)}% sure</small></td><td>${teacher ? (teacher.answer ? `${teacher.answer.lat.toFixed(2)}, ${teacher.answer.lon.toFixed(2)}` : 'no answer') : waiting ? '<em>thinking...</em>' : '<em>not asked</em>'}</td></tr>
          <tr><th>Time to answer</th><td class="big">${fr.ms < 1 ? fr.ms.toFixed(2) : fr.ms.toFixed(1)} ms</td><td class="big">${teacher ? secs(teacher.ms) : ''}</td></tr>
          <tr><th>Reading the item</th><td>${Math.round(fr.embedMs)} ms</td><td></td></tr>
          <tr><th>Round trip here</th><td>${Math.round(fWall)} ms</td><td></td></tr>
          <tr><th>Cost</th><td>nothing</td><td>${teacher ? (teacher.usd ? money(teacher.usd) : 'nothing') : ''}</td></tr>
        </tbody></table>
        <ol class="odds">${top.map((t, j) => `<li><span class="bar" style="--w:${t.p}"></span><b>${Math.round(t.p * 100)}%</b> ${t.lat.toFixed(2)}, ${t.lon.toFixed(2)}</li>`).join('')}</ol>
        ${agree !== null ? `<p class="hand-note">${agree < 50 ? `They agree: the fossil's first choice is ${dist(agree)} from its teacher's answer.` : `They disagree by ${dist(agree)}.`}</p>` : ''}`;
      };
      render(null, withTeacher);
      if (withTeacher) {
        const tr = await post('/try', { voyage: f.voyage, genome: f.genome, text, date: new Date().toISOString().slice(0, 10), allowPaid: f.teacher_usd > 0 }).then(r => r.json()).catch(() => null);
        render(tr && !tr.error ? tr : { answer: null, ms: 0, usd: 0 }, false);
      }
      btn.disabled = false; btn.textContent = 'Ask it again';
    });
  });
}

function drawSlab(cv: HTMLCanvasElement, f: any, i: number, name: string) {
  const k = cv.getContext('2d')!, W = cv.width, H = cv.height;
    const rnd = (() => { let x = 7 + i * 101; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
    // the stone: a warm grey limestone, cut with uneven edges and lit from the top left
    k.clearRect(0, 0, W, H);
    const edge: [number, number][] = []; const m = 14;
    for (let t = 0; t < 1; t += .02) edge.push([m + t * (W - 2 * m), m + (rnd() - .5) * 8]);
    for (let t = 0; t < 1; t += .03) edge.push([W - m + (rnd() - .5) * 8, m + t * (H - 2 * m)]);
    for (let t = 1; t > 0; t -= .02) edge.push([m + t * (W - 2 * m), H - m + (rnd() - .5) * 8]);
    for (let t = 1; t > 0; t -= .03) edge.push([m + (rnd() - .5) * 8, m + t * (H - 2 * m)]);
    k.save(); k.beginPath(); edge.forEach(([x, y], j) => j ? k.lineTo(x, y) : k.moveTo(x, y)); k.closePath();
    k.shadowColor = 'rgba(20,16,10,.45)'; k.shadowBlur = 30; k.shadowOffsetY = 14;
    const g = k.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#b3ab9b'); g.addColorStop(1, '#8a8274'); k.fillStyle = g; k.fill(); k.restore();
    k.save(); k.beginPath(); edge.forEach(([x, y], j) => j ? k.lineTo(x, y) : k.moveTo(x, y)); k.closePath(); k.clip();
    for (let j = 0; j < 26000; j++) { k.fillStyle = `rgba(${rnd() < .5 ? '52,46,38' : '236,230,216'},${rnd() * .09})`; const r = rnd() * 2.2; k.fillRect(rnd() * W, rnd() * H, r, r); }
    const curve = (f.curve ?? []) as { held_out_loss: number; held_out_agreement: number }[];
    const L = curve.map(p => p.held_out_loss), lo = Math.min(...L), hi = Math.max(...L);
    const x0 = 90, x1 = W - 70, y0 = 250, yS = 280, x = (j: number) => x0 + j / Math.max(1, curve.length - 1) * (x1 - x0);
    const yAt = (j: number, band: number) => y0 + band * 26 + (L[j] - lo) / Math.max(1e-9, hi - lo) * yS * (1 - band * .07) + Math.sin(j * .7 + band * 1.9) * 1.6;
    // strata: each band follows the held-out curve, darker and finer with depth, each with a lit lip
    for (let band = 0; band < 9; band++) {
      k.beginPath(); curve.forEach((_, j) => j ? k.lineTo(x(j), yAt(j, band)) : k.moveTo(x(j), yAt(j, band)));
      k.lineTo(x1 + 60, yAt(curve.length - 1, band)); k.lineTo(x1 + 60, H); k.lineTo(x0 - 80, H); k.lineTo(x0 - 80, yAt(0, band)); k.closePath();
      k.fillStyle = `rgba(${60 - band * 3},${52 - band * 3},${42 - band * 3},${.06 + band * .012})`; k.fill();
      k.beginPath(); curve.forEach((_, j) => j ? k.lineTo(x(j), yAt(j, band)) : k.moveTo(x(j), yAt(j, band)));
      k.strokeStyle = `rgba(28,24,18,${band ? .38 - band * .025 : .8})`; k.lineWidth = band ? 1.3 : 3; k.stroke();
      k.save(); k.translate(0, band ? 1.4 : 2.2); k.strokeStyle = 'rgba(246,240,226,.4)'; k.lineWidth = 1; k.stroke(); k.restore();
    }
    // the impression: an ammonite pressed in at the kept pass
    const ke = Math.max(0, Math.min(curve.length - 1, (f.kept_epoch ?? 1) - 1)), cx = x(ke), cy = yAt(ke, 0) + 2;
    const shell = (dx: number, dy: number, col: string, w: number) => { k.beginPath(); for (let t = 0; t < 4.2 * Math.PI; t += .05) { const r = 4 + Math.exp(t * .18) * 4.6; const px = cx + dx + Math.cos(t) * r, py = cy + dy + Math.sin(t) * r; t ? k.lineTo(px, py) : k.moveTo(px, py); } k.strokeStyle = col; k.lineWidth = w; k.stroke();
      for (let t = 1.2; t < 4.2 * Math.PI; t += .42) { const r0 = 4 + Math.exp((t - 2 * Math.PI) * .18) * 4.6, r1 = 4 + Math.exp(t * .18) * 4.6; if (t < 2 * Math.PI) continue; k.beginPath(); k.moveTo(cx + dx + Math.cos(t) * r0, cy + dy + Math.sin(t) * r0); k.lineTo(cx + dx + Math.cos(t) * r1, cy + dy + Math.sin(t) * r1); k.lineWidth = w * .5; k.stroke(); } };
    k.beginPath(); k.arc(cx, cy, 44, 0, Math.PI * 2); k.fillStyle = 'rgba(40,34,26,.16)'; k.fill();
    shell(1.5, 1.5, 'rgba(246,240,226,.55)', 1.6); shell(0, 0, 'rgba(30,25,18,.85)', 1.6);
    k.strokeStyle = 'rgba(30,25,18,.55)'; k.lineWidth = 1.2; k.beginPath(); k.moveTo(cx + 40, cy - 30); k.lineTo(cx + 96, cy - 62); k.lineTo(cx + 120, cy - 62); k.stroke();
    // incised lettering: the name, and a scale cut along the bottom edge
    const incise = (t: string, px: number, py: number, font: string, al: CanvasTextAlign = 'left') => { k.font = font; k.textAlign = al; k.fillStyle = 'rgba(246,240,226,.5)'; k.fillText(t, px + 1.2, py + 1.6); k.fillStyle = 'rgba(30,25,18,.82)'; k.fillText(t, px, py); };
    incise(name, 60, 86, '46px "IM Fell English SC"');
    incise(`kept: pass ${f.kept_epoch}`, cx + 128, cy - 54, 'italic 26px "EB Garamond"');
    incise(`${pct(f.race.score)} on the race · teacher ${pct(f.race.teacher)} · ${(f.bytes / 1e6).toFixed(1)} MB`, 62, 124, 'italic 26px "EB Garamond"');
    for (let j = 0; j < curve.length; j += 5) { k.strokeStyle = 'rgba(30,25,18,.6)'; k.lineWidth = 1.4; k.beginPath(); k.moveTo(x(j), H - 74); k.lineTo(x(j), H - 62); k.stroke(); incise(String(j + 1), x(j), H - 38, '20px "EB Garamond"', 'center'); }
    incise('pass', x1, H - 38, 'italic 20px "EB Garamond"', 'right');
    k.restore();
}
