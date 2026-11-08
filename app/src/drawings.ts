// Engravings drawn in code: an agent as an organism whose anatomy is its design (the plate),
// and a sea chart of one task's answers (the chart). Both draw to a 2D canvas, so they serve
// as textures inside the ship and as full-size pages in the rooms.
import { geoMercator, geoPath, geoCircle, geoGraticule, geoArea, geoDistance, geoEquirectangular } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import world from 'world-atlas/countries-50m.json';
import type { Genome, Telling } from './data.ts';

export const INK = '#241c14', SOFT = '#6a5a44', RED = '#8f2a1c', PAPER = '#efe7d3', SEA = '#d7ccad';
const rng = (s: number) => { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export const hash = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

export function paper(k: CanvasRenderingContext2D, w: number, h: number, base = PAPER, seed = 5) {
  const r = rng(seed); k.fillStyle = base; k.fillRect(0, 0, w, h);
  for (let i = 0; i < (w * h) / 3500; i++) { k.strokeStyle = `rgba(110,85,50,${.03 + r() * .05})`; k.lineWidth = .6; const x = r() * w, y = r() * h, a = r() * 6.3, l = 4 + r() * 14; k.beginPath(); k.moveTo(x, y); k.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); k.stroke(); }
  const g = k.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .3, w / 2, h / 2, Math.max(w, h) * .75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(90,60,25,.14)'); k.fillStyle = g; k.fillRect(0, 0, w, h);
}

// The organism. Workflow is the body; the gazetteer a crown of spines; worked examples seeds
// around it; the model sets how densely it is engraved. Drawn centred at (cx, cy), radius ~R.
export function organism(k: CanvasRenderingContext2D, g: Pick<Genome, 'tools' | 'workflow' | 'memory' | 'model'> & { id: string }, cx: number, cy: number, R: number) {
  const r = rng(hash(g.id)), s = R / 60;
  const dense = /sonnet|opus/.test(g.model) ? 1 : /haiku/.test(g.model) ? .7 : g.model === 'none' ? .25 : .45;
  k.save(); k.strokeStyle = INK; k.fillStyle = INK; k.lineCap = 'round';
  const blob = (x: number, y: number, rad: number, w = 1.1) => { k.lineWidth = w * s; k.beginPath(); const ph = r() * 6, amp = rad * .035; for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, rr = rad + Math.sin(a * 5 + ph) * amp + Math.sin(a * 3 - ph) * amp * .6; i ? k.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : k.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } k.closePath(); k.stroke(); };
  const stipple = (x: number, y: number, rad: number, n: number) => { for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = rad * Math.sqrt(r()), px = x + Math.cos(a) * d, py = y + Math.sin(a) * d; const shade = ((px - x) + (py - y)) / (2 * rad) + .5; if (r() < shade * shade) { k.beginPath(); k.arc(px, py, (.35 + r() * .35) * s, 0, 7); k.fill(); } } };
  const cell = (x: number, y: number, rad: number) => {
    blob(x, y, rad); blob(x, y, rad * .93, .4);
    const septa = Math.round(8 + dense * 8); k.lineWidth = .45 * s;
    for (let i = 0; i < septa; i++) { const a = i / septa * Math.PI * 2 + r() * .1; k.beginPath(); k.moveTo(x + Math.cos(a) * rad * .36, y + Math.sin(a) * rad * .36); k.lineTo(x + Math.cos(a) * rad * .9, y + Math.sin(a) * rad * .9); k.stroke(); }
    blob(x, y, rad * .34, .8); stipple(x, y, rad * .3, Math.round((30 + 60 * dense) * s * s)); stipple(x, y, rad * .92, Math.round((120 + 260 * dense) * s * s));
  };
  if (g.tools.includes('lookup_place')) for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2 + r() * .05, r0 = 33 * s, r1 = (50 + (i % 2) * 9 + r() * 3) * s;
    k.beginPath(); k.moveTo(cx + Math.cos(a - .03) * r0, cy + Math.sin(a - .03) * r0); k.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); k.lineTo(cx + Math.cos(a + .03) * r0, cy + Math.sin(a + .03) * r0); k.globalAlpha = .8; k.fill(); k.globalAlpha = 1;
    k.beginPath(); k.arc(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, 1.1 * s, 0, 7); k.fill();
  }
  const shape = g.workflow.shape;
  if (shape === 'single') cell(cx, cy, 28 * s);
  else if (shape === 'plan-then-answer') { cell(cx - 20 * s, cy + 8 * s, 18 * s); cell(cx + 16 * s, cy - 10 * s, 24 * s); k.lineWidth = 2 * s; k.beginPath(); k.moveTo(cx - 6 * s, cy); k.lineTo(cx + 2 * s, cy - 4 * s); k.stroke(); }
  else if (shape === 'self-check') { cell(cx, cy, 21 * s); blob(cx, cy, 33 * s, 1.2); blob(cx, cy, 37 * s, .5); k.lineWidth = .4 * s; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; k.beginPath(); k.moveTo(cx + Math.cos(a) * 33 * s, cy + Math.sin(a) * 33 * s); k.lineTo(cx + Math.cos(a) * 37 * s, cy + Math.sin(a) * 37 * s); k.stroke(); } }
  else if (shape === 'vote') { const n = g.workflow.n ?? 3; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 - Math.PI / 2; cell(cx + Math.cos(a) * 20 * s, cy + Math.sin(a) * 20 * s, 15 * s); } }
  else { k.save(); k.translate(cx, cy); k.rotate(r() * .5); k.lineWidth = 1.1 * s; k.strokeRect(-22 * s, -22 * s, 44 * s, 44 * s); k.restore(); stipple(cx, cy, 16 * s, 80); }
  for (let i = 0; i < g.memory.examples; i++) { const a = i / g.memory.examples * Math.PI * 2 + .3; k.save(); k.translate(cx + Math.cos(a) * 62 * s, cy + Math.sin(a) * 54 * s); k.rotate(a); k.beginPath(); k.ellipse(0, 0, 3.2 * s, 2.2 * s, 0, 0, 7); k.fill(); k.restore(); }
  k.restore();
}

// A scale bar from 0 to 100 with the score as a filled bar and its 95% interval as a fine line.
export function scaleBar(k: CanvasRenderingContext2D, x0: number, x1: number, y: number, mean: number, lo: number, hi: number, s = 1) {
  const at = (v: number) => x0 + (x1 - x0) * v;
  k.save(); k.strokeStyle = INK; k.fillStyle = INK; k.lineWidth = .7 * s;
  k.beginPath(); k.moveTo(x0, y); k.lineTo(x1, y); k.stroke();
  for (let t = 0; t <= 10; t++) { k.beginPath(); k.moveTo(at(t / 10), y); k.lineTo(at(t / 10), y + (t % 5 ? 3 : 6) * s); k.stroke(); }
  k.fillRect(x0, y - 6 * s, (x1 - x0) * mean, 5 * s);
  k.lineWidth = .8 * s; k.beginPath(); k.moveTo(at(lo), y - 10 * s); k.lineTo(at(hi), y - 10 * s); k.moveTo(at(lo), y - 12.5 * s); k.lineTo(at(lo), y - 7.5 * s); k.moveTo(at(hi), y - 12.5 * s); k.lineTo(at(hi), y - 7.5 * s); k.stroke();
  k.restore();
}

// The chart: one task, centred on where it happened, every answer near it numbered.
const land: any = feature(world as any, (world as any).objects.countries);
land.features = land.features.filter((f: any) => f.properties?.name !== 'Antarctica' && geoArea(f) < 2 * Math.PI);
const borders = mesh(world as any, (world as any).objects.countries, (a: any, b: any) => a !== b);
export const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371;

export function chart(k: CanvasRenderingContext2D, W: number, H: number, t: Telling, o: { left?: number; labels?: boolean } = {}) {
  const truth = t.task.truth.places[0];
  const near = t.answers.map((a, i) => ({ ...a, i: i + 1, d: a.answer ? km(a.answer, truth) : null })).filter(a => a.d !== null && a.d < 300);
  const fitTo: any = { type: 'GeometryCollection', geometries: [geoCircle().center([truth.lon, truth.lat]).radius(60 / 6371 * 180 / Math.PI)(), { type: 'MultiPoint', coordinates: near.filter(a => a.d! < 80).map(a => [a.answer!.lon, a.answer!.lat]) }] };
  const proj = geoMercator().fitExtent([[W * (o.left ?? .08), H * .08], [W * .94, H * .92]], fitTo).clipExtent([[0, 0], [W, H]]);
  const path = geoPath(proj, k);
  paper(k, W, H, SEA, 11);
  k.strokeStyle = 'rgba(36,28,20,.22)'; k.lineWidth = 1; for (let y = 0; y < H; y += 7) { k.beginPath(); k.moveTo(0, y + .5); k.lineTo(W, y + .5); k.stroke(); }
  k.beginPath(); path(geoGraticule().step([1, 1])()); k.strokeStyle = 'rgba(36,28,20,.18)'; k.lineWidth = .8; k.stroke();
  k.beginPath(); path(land); k.fillStyle = '#f1e9d4'; k.fill(); k.strokeStyle = INK; k.lineWidth = 1.6; k.stroke();
  k.beginPath(); path(borders); k.setLineDash([6, 3, 1.5, 3]); k.lineWidth = 1; k.stroke(); k.setLineDash([]);
  const ring = (r: number) => { k.beginPath(); path(geoCircle().center([truth.lon, truth.lat]).radius(r / 6371 * 180 / Math.PI)()); k.setLineDash([7, 4]); k.strokeStyle = RED; k.lineWidth = 1.3; k.stroke(); k.setLineDash([]); };
  ring(25); ring(250);
  const [tx, ty] = proj([truth.lon, truth.lat])!;
  k.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rr = i % 2 ? 7 : 19; i ? k.lineTo(tx + Math.cos(a) * rr, ty + Math.sin(a) * rr) : k.moveTo(tx + Math.cos(a) * rr, ty + Math.sin(a) * rr); } k.closePath(); k.fillStyle = RED; k.fill(); k.strokeStyle = INK; k.lineWidth = .8; k.stroke();
  const placed: [number, number][] = [];
  for (const a of near) {
    const [x, y] = proj([a.answer!.lon, a.answer!.lat])!; let lx = x + 34, ly = y - 24;
    for (let tries = 0; tries < 40 && placed.some(p => Math.hypot(p[0] - lx, p[1] - ly) < 32); tries++) { const ang = tries * 2.4, rad = 34 + tries * 4; lx = x + Math.cos(ang) * rad; ly = y + Math.sin(ang) * rad; }
    placed.push([lx, ly]);
    k.strokeStyle = INK; k.lineWidth = .9; k.beginPath(); k.moveTo(x, y); k.lineTo(lx, ly); k.stroke();
    k.beginPath(); k.arc(x, y, 4.5, 0, 7); k.fillStyle = a.control ? '#f1e9d4' : INK; k.fill(); k.stroke();
    k.beginPath(); k.arc(lx, ly, 14, 0, 7); k.fillStyle = '#f1e9d4'; k.fill(); k.stroke();
    k.fillStyle = INK; k.font = '18px "IM Fell English"'; k.textAlign = 'center'; k.fillText(String(a.i), lx, ly + 6); k.textAlign = 'left';
  }
  return { proj, truth };
}

// The whole globe, small, with the truth and every far-off answer
export function inset(k: CanvasRenderingContext2D, W: number, H: number, t: Telling) {
  const truth = t.task.truth.places[0], proj = geoEquirectangular().fitExtent([[2, 2], [W - 2, H - 2]], { type: 'Sphere' } as any), path = geoPath(proj, k);
  paper(k, W, H, '#ece3cc', 3);
  k.beginPath(); path(land); k.fillStyle = '#e1d6b9'; k.fill(); k.strokeStyle = INK; k.lineWidth = .6; k.stroke();
  const [tx, ty] = proj([truth.lon, truth.lat])!;
  t.answers.forEach((a, i) => { if (!a.answer || km(a.answer, truth) < 300) return; const [x, y] = proj([a.answer.lon, a.answer.lat])!; k.setLineDash([4, 3]); k.strokeStyle = RED; k.lineWidth = 1; k.beginPath(); k.moveTo(tx, ty); k.lineTo(x, y); k.stroke(); k.setLineDash([]); k.fillStyle = INK; k.beginPath(); k.arc(x, y, 4, 0, 7); k.fill(); k.font = '15px "IM Fell English"'; k.fillText(String(i + 1), x + 6, y + 5); });
  k.fillStyle = RED; k.beginPath(); k.arc(tx, ty, 4.5, 0, 7); k.fill();
}
