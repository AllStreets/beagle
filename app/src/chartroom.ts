// The chart room. Two sheets: the race items, each with every answer the field gave; and your
// own item, which any agent of the voyage answers live, graded against wherever you say it
// really happened.
import { api, post, entrants, pct, type Telling, type Entrant } from './data.ts';
import { esc, money, secs, dist, head } from './ui.ts';
import { drawSheet, type Sheet, type Sounding, type Place } from './chartsheet.ts';
import { grade } from '../../src/arenas/geotag/grade.ts';
import { geoDistance } from 'd3-geo';
import type { Ctx } from './rooms.ts';
import { workTable, ownPlain } from './worktable.ts';

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371;
const tabs = (on: 'race' | 'own') => `<nav class="pages chart-tabs"><a class="${on === 'race' ? 'on' : ''}" href="#/chart">The race items</a><a class="${on === 'own' ? 'on' : ''}" href="#/chart/own">Set your own item</a></nav>`;

export async function chartRoom(el: HTMLElement, c: Ctx) {
  const kind = c.arena?.kind ?? 'geotag';
  if (kind !== 'geotag') {
    if (location.hash.startsWith('#/chart/own') && kind !== 'fixtest') return ownPlain(el, c, kind, entrants(c.gen), (genome, text, allowPaid) => post('/try', { voyage: c.voyage.id, genome, text, allowPaid }).then(r => r.json()));
    return workTable(el, c, kind);
  }
  if (location.hash.startsWith('#/chart/own')) return ownItem(el, c);
  const tasks = await api<{ id: string; date: string; shown: string; mean: number; answered: number }[]>(`/voyages/${c.voyage.id}/generations/${c.genN}/tasks`, []);
  const first = await api<Telling>(`/voyages/${c.voyage.id}/generations/${c.genN}/telling`);
  el.innerHTML = `${tabs('race')}${head('The chart room', `Pick a news item. Its places were hidden from the agents; the chart shows where each one answered, against where it really happened.`)}
  <div class="chart-room">
    <div class="items-wrap"><div class="items-head"><span>${tasks.length} items, hardest first</span><span>Average</span></div><ol class="items" aria-label="News items in this race, hardest first">${tasks.map(t => `<li><button data-task="${t.id}" class="${t.id === first.task.id ? 'on' : ''}"><span class="d">${t.date}</span><span class="t">${esc(t.shown)}</span><span class="m">${pct(t.mean)}</span></button></li>`).join('')}</ol></div>
    <figure class="sheet"><canvas id="chart" role="img" aria-label="A chart of where each agent answered"></canvas><figcaption id="cap"></figcaption></figure>
    <table class="answers" id="answers"></table>
  </div>`;
  let stop = () => {};
  const show = (t: Telling) => {
    stop();
    const truth = t.task.truth.places;
    const sheet: Sheet = { title: truth.map(p => p.name).join(', '), sub: `${t.task.input.date}. Where ${t.answers.length} agents and controls said it happened; the red star is where it did.`, truth, soundings: t.answers.map((a, i) => ({ n: i + 1, name: a.name, control: a.control, answer: a.answer })) };
    const d = drawSheet(el.querySelector<HTMLCanvasElement>('#chart')!, sheet); stop = d.stop;
    const far = d.far.length ? ` <span class="far">Off this sheet: ${d.far.map(f => `${f.n}, ${esc(f.name)}, ${dist(Math.min(...truth.map(p => km(f.answer!, p))))} away`).join('; ')}.</span>` : '';
    el.querySelector('#cap')!.innerHTML = `<b>${t.task.input.date}.</b> ${esc(t.task.shown.split('\n').slice(1).join(' ')).replace(/\[place\]/g, '<mark>[place]</mark>')} <span>Truth: ${truth.map(p => esc(p.name)).join(', ')}.</span>${far}`;
    el.querySelector('#answers')!.innerHTML = `<thead><tr><th></th><th>Agent</th><th>Off by</th><th>Score</th>${c.view === 'lab' ? '<th>Answer</th>' : ''}</tr></thead><tbody>${t.answers.map((a, i) => {
      const dd = a.answer ? Math.min(...truth.map(p => km(a.answer!, p))) : null;
      return `<tr class="${a.control ? 'ctl' : ''}"><td>${i + 1}</td><td><a href="#/drawing/${encodeURIComponent(a.genome)}">${esc(a.name)}</a></td><td>${dist(dd)}</td><td>${pct(a.score)}</td>${c.view === 'lab' ? `<td class="mono"><a href="#/run/${a.run}">${a.answer ? `${a.answer.lat.toFixed(3)}, ${a.answer.lon.toFixed(3)}` : a.status}</a></td>` : ''}</tr>`;
    }).join('')}</tbody>`;
  };
  show(first);
  el.querySelector('.items button.on')?.scrollIntoView({ block: 'center' });
  el.querySelectorAll<HTMLButtonElement>('.items button').forEach(b => b.addEventListener('click', async () => {
    el.querySelectorAll('.items button').forEach(x => x.classList.toggle('on', x === b));
    show(await api<Telling>(`/voyages/${c.voyage.id}/generations/${c.genN}/telling?task=${b.dataset.task}`));
  }));
}

// ---------- your own item ----------
type Asked = { e: Entrant; state: 'waiting' | 'asking' | 'done' | 'failed'; answer: { lat: number; lon: number } | null; usd: number; ms: number; note: string; trace?: { kind: string; output: unknown }[] };
const draftKey = 'beagle.own-item';
const EXAMPLE = 'A landslide after days of heavy rain buries part of a village in [place], in the hills above [place]; rescuers search for 14 people missing.';

async function ownItem(el: HTMLElement, c: Ctx) {
  const es = entrants(c.gen), agents = es.filter(e => !e.control), controls = es.filter(e => e.control && !e.genome.includes('random'));
  const local = (e: Entrant) => e.control ? !e.genome.includes('Claude') : !(e.body?.model ?? '').startsWith('claude:');
  const perItem = (e: Entrant) => e.tasks ? e.usd / e.tasks : 0;
  let draft = ''; try { draft = localStorage.getItem(draftKey) ?? ''; } catch { /* a private window */ }
  const row = (e: Entrant) => `<label class="pick"><input type="checkbox" name="g" value="${esc(e.genome)}" ${local(e) ? 'checked' : ''}><span>${esc(e.name)}</span><small>${local(e) ? 'free, on this Mac' : `about ${money(perItem(e))}`}</small></label>`;
  el.innerHTML = `${tabs('own')}${head('Set your own item', 'Write a news item the way the arena does, with the places replaced by [place], or leave them in. Pick who answers. Then, if you know where it happened, mark it on the chart and every answer is graded against it.')}
  <div class="own">
    <form class="own-form" id="own">
      <label class="field"><span class="l">The news item</span><textarea name="text" rows="6" placeholder="${esc(EXAMPLE)}">${esc(draft)}</textarea></label>
      <label class="field date"><span class="l">Its date</span><input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <fieldset class="who"><legend>Agents of generation ${c.genN + 1}</legend>${agents.map(row).join('')}</fieldset>
      <fieldset class="who"><legend>Controls</legend>${controls.map(row).join('')}</fieldset>
      <p class="cost" id="cost"></p>
      <button type="submit" class="ask">Ask them</button>
    </form>
    <div class="own-out">
      <figure class="sheet"><canvas id="chart" role="img" aria-label="A chart of where each agent answered your item"></canvas><figcaption><span id="cap">The answers land here as they come in.</span><span class="far" id="far"></span></figcaption></figure>
      <table class="answers" id="answers"></table>
    </div>
  </div>`;
  const form = el.querySelector<HTMLFormElement>('#own')!, cv = el.querySelector<HTMLCanvasElement>('#chart')!;
  const cost = () => { const picked = [...form.querySelectorAll<HTMLInputElement>('input[name=g]:checked')].map(i => es.find(e => e.genome === i.value)!), paid = picked.filter(e => !local(e)); el.querySelector('#cost')!.textContent = paid.length ? `${picked.length} chosen. ${paid.length} run on Claude: about ${money(paid.reduce((n, e) => n + perItem(e), 0))} in all, counted in the voyage's ledger.` : `${picked.length} chosen, all free.`; };
  form.addEventListener('change', cost); cost();
  form.querySelector('textarea')!.addEventListener('input', e => { try { localStorage.setItem(draftKey, (e.target as HTMLTextAreaElement).value); } catch { /* fine */ } });

  let asked: Asked[] = [], truth: Place | null = null, stop = () => {}, drawn = 0, proj: any = null;
  const sheet = (): Sheet => ({ wide: true, title: truth ? 'Where you said' : 'Your own item', sub: truth ? `Graded against the point you marked. ${asked.filter(a => a.state === 'done').length} answers.` : 'Click the chart where it really happened, and every answer is graded against it.', truth: truth ? [truth] : [], soundings: asked.map((a, i) => ({ n: i + 1, name: a.e.name, control: a.e.control, answer: a.answer } as Sounding)) });
  const redraw = (animateNew = true) => {
    stop(); const n = asked.filter(a => a.answer).length; const d = drawSheet(cv, sheet(), animateNew ? drawn : n); stop = d.stop; proj = d.proj; drawn = n; table();
    const far = el.querySelector('#far')!; far.textContent = d.far.length ? `Off this sheet: ${d.far.map(f => `${f.n}, ${f.name}${truth ? `, ${dist(km(f.answer!, truth))} away` : ''}`).join('; ')}.` : '';
  };
  const table = () => {
    el.querySelector('#answers')!.innerHTML = `<thead><tr><th></th><th>Agent</th><th>${truth ? 'Off by' : 'Answer'}</th>${truth ? '<th>Score</th>' : ''}<th>Time</th><th>Cost</th></tr></thead><tbody>${asked.map((a, i) => {
      const d = truth && a.answer ? km(a.answer, truth) : null;
      const said = a.state === 'asking' ? '<em>asking...</em>' : a.state === 'waiting' ? '<em>waiting</em>' : a.state === 'failed' ? `<em>${esc(a.note)}</em>` : !a.answer ? '<em>no answer</em>' : truth ? dist(d) : `${a.answer.lat.toFixed(2)}, ${a.answer.lon.toFixed(2)}`;
      return `<tr class="${a.e.control ? 'ctl' : ''}"><td>${i + 1}</td><td>${esc(a.e.name)}${a.trace?.length ? `<details><summary>its steps</summary><ol class="trace mini">${a.trace.map(s => `<li><b>${esc(s.kind)}</b> ${esc(typeof s.output === 'string' ? s.output : JSON.stringify(s.output)).slice(0, 600)}</li>`).join('')}</ol></details>` : ''}</td><td>${said}</td>${truth ? `<td>${a.state === 'done' ? pct(grade(a.answer, { places: [truth] })) : ''}</td>` : ''}<td>${a.ms ? secs(a.ms) : ''}</td><td>${a.state === 'done' ? (a.usd ? money(a.usd) : 'free') : ''}</td></tr>`;
    }).join('')}</tbody>`;
  };
  cv.addEventListener('click', ev => {
    if (!proj || !asked.length) return;
    const r = cv.getBoundingClientRect(), p = proj.invert([ev.clientX - r.left, ev.clientY - r.top]);
    if (!p) return;
    truth = { name: `${Math.abs(p[1]).toFixed(2)}° ${p[1] >= 0 ? 'N' : 'S'}, ${Math.abs(p[0]).toFixed(2)}° ${p[0] >= 0 ? 'E' : 'W'}`, lat: p[1], lon: p[0] };
    redraw(false);
  });
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = new FormData(form), text = String(fd.get('text') ?? '').trim() || EXAMPLE, date = String(fd.get('date') ?? '');
    const picked = fd.getAll('g').map(g => es.find(e => e.genome === g)!).filter(Boolean);
    if (!picked.length) { el.querySelector('#cost')!.textContent = 'Choose at least one agent.'; return; }
    const paid = picked.some(e => !local(e));
    if (paid && !confirm(`${picked.filter(e => !local(e)).length} of these run on Claude and cost about ${money(picked.filter(e => !local(e)).reduce((n, e) => n + perItem(e), 0))} in all. Ask them?`)) return;
    form.querySelector<HTMLTextAreaElement>('textarea')!.value = text;
    asked = picked.map(e => ({ e, state: 'waiting', answer: null, usd: 0, ms: 0, note: '' })); truth = null; drawn = 0; redraw();
    el.querySelector('#cap')!.innerHTML = `<b>${esc(date)}.</b> ${esc(text).replace(/\[place\]/g, '<mark>[place]</mark>')}`;
    const btn = form.querySelector<HTMLButtonElement>('.ask')!; btn.disabled = true; btn.textContent = 'Asking...';
    // local models share one machine, so at most two at once; Claude ones run alongside
    let next = 0;
    const worker = async () => { while (next < asked.length) { const a = asked[next++]; a.state = 'asking'; table();
      try {
        const r = await post('/try', { voyage: c.voyage.id, genome: a.e.genome, text, date, allowPaid: !local(a.e) });
        const j = await r.json();
        if (!r.ok) { a.state = 'failed'; a.note = j.error ?? `${r.status}`; }
        else { a.state = 'done'; a.answer = j.answer; a.usd = j.usd; a.ms = j.ms; a.trace = j.trace; }
      } catch (e) { a.state = 'failed'; a.note = (e as Error).message; }
      redraw();
    } };
    await Promise.all([worker(), worker(), worker()]);
    btn.disabled = false; btn.textContent = 'Ask them again';
  });
}
