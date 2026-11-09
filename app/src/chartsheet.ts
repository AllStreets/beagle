// The chart room's sheet, drawn like an Admiralty chart: a neat line with a degree scale on all
// four sides, a compass rose, a scale of kilometres, and a title cartouche. Answers arrive one at
// a time, like soundings, each with a ripple; the truth is a red star lettered with its name.
import { geoMercator, geoPath, geoGraticule, geoCircle, geoDistance } from 'd3-geo';
import { paper, land, borders, INK, RED } from './drawings.ts';

export type Place = { name: string; lat: number; lon: number };
export type Sounding = { n: number; name: string; control: boolean; answer: { lat: number; lon: number } | null };
export type Sheet = { title: string; sub: string; truth: Place[]; soundings: Sounding[]; wide?: boolean };   // wide: keep every answer within 3,000 km in view

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 6371;
const DIDONE = '"Bodoni Moda", "IM Fell English", serif', SEA = '#d9cfb2', LAND = '#f2ead6';
const nice = (x: number) => { const p = 10 ** Math.floor(Math.log10(x)), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };

// `settled` answers are drawn at once; only the ones after them land with a ripple
export function drawSheet(cv: HTMLCanvasElement, s: Sheet, settled = 0) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio), W = r.width, H = r.height;
  cv.width = W * dpr; cv.height = H * dpr;
  const k = cv.getContext('2d')!; k.setTransform(dpr, 0, 0, dpr, 0, 0);
  const B = 24, F = 40;             // outer margin, and where the map's neat line sits
  // fit: the truth and the answers near it, or, with no truth, the middle of the answers
  const pts = s.soundings.filter(a => a.answer).map(a => a.answer!);
  const centre = s.truth[0] ?? medoid(pts) ?? { lat: 20, lon: 0 };
  const near = pts.filter(p => km(p, centre) < (s.wide ? 3000 : s.truth.length ? 80 : 900));
  // nothing to show yet: the whole inhabited world, from 56 S to 72 N
  const fit: any = !s.truth.length && !pts.length ? { type: 'MultiPoint', coordinates: [[-170, -56], [190, 72]] }
    : { type: 'GeometryCollection', geometries: [geoCircle().center([centre.lon, centre.lat]).radius((s.truth.length ? 60 : 300) / 6371 * 180 / Math.PI)(), { type: 'MultiPoint', coordinates: near.map(p => [p.lon, p.lat]) }] };
  const proj = geoMercator().fitExtent([[F + 40, F + 40], [W - F - 40, H - F - 40]], fit).clipExtent([[F, F], [W - F, H - F]]);
  const path = geoPath(proj, k);

  // the base, drawn once into its own canvas, then composed under the soundings each frame
  const base = document.createElement('canvas'); base.width = cv.width; base.height = cv.height;
  const b = base.getContext('2d')!; b.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bp = geoPath(proj, b);
  paper(b, W, H, '#efe7d3', 4);
  b.save(); b.beginPath(); b.rect(F, F, W - 2 * F, H - 2 * F); b.clip();
  paper(b, W, H, SEA, 11);
  b.strokeStyle = 'rgba(36,28,20,.16)'; b.lineWidth = .7; for (let y = F; y < H - F; y += 6) { b.beginPath(); b.moveTo(F, y + .5); b.lineTo(W - F, y + .5); b.stroke(); }
  // the coast, engraved: land, then waterlines stepping out to sea
  for (let i = 4; i >= 1; i--) { b.beginPath(); bp(land); b.strokeStyle = `rgba(36,28,20,${.05 + (4 - i) * .03})`; b.lineWidth = i * 5; b.stroke(); }
  b.beginPath(); bp(land); b.fillStyle = LAND; b.fill(); b.strokeStyle = INK; b.lineWidth = 1.5; b.stroke();
  b.beginPath(); bp(borders); b.setLineDash([6, 3, 1.5, 3]); b.lineWidth = .9; b.stroke(); b.setLineDash([]);
  const [lon0, lat1] = proj.invert!([F, F])!, [lon1, lat0] = proj.invert!([W - F, H - F])!;
  const step = [30, 20, 10, 5, 2, 1, .5, .25, .1, .05, .02].find(st => (lon1 - lon0) / st >= 4) ?? .02;
  b.beginPath(); bp(geoGraticule().step([step, step]).extent([[lon0 - step, lat0 - step], [lon1 + step, lat1 + step]])()); b.strokeStyle = 'rgba(36,28,20,.28)'; b.lineWidth = .6; b.stroke();
  if (s.truth.length) for (const [rad, lab] of [[25, '25 km: full marks'], [250, '250 km']] as const) {
    b.beginPath(); bp(geoCircle().center([centre.lon, centre.lat]).radius(rad / 6371 * 180 / Math.PI)()); b.setLineDash([7, 4]); b.strokeStyle = RED; b.lineWidth = 1.2; b.stroke(); b.setLineDash([]);
    const [x, y] = proj([centre.lon, centre.lat + rad / 111])!; if (y > F + 14) { b.font = `italic 12px ${DIDONE}`; b.fillStyle = RED; b.textAlign = 'center'; b.fillText(lab, x, y - 5); }
  }
  rose(b, W - F - 86, F + 86, 62);
  b.restore();
  // the neat line, and the degree scale between it and the border, alternate black and white
  b.strokeStyle = INK; b.lineWidth = 1; b.strokeRect(B + .5, B + .5, W - 2 * B - 1, H - 2 * B - 1); b.lineWidth = 1.6; b.strokeRect(F, F, W - 2 * F, H - 2 * F);
  const band = (x0: number, y0: number, x1: number, y1: number, along: 'x' | 'y', v0: number, v1: number, at: (v: number) => number) => {
    const sub = step / 5; let i = Math.floor(v0 / sub);
    for (let v = i * sub; v < v1; v += sub, i++) {
      const p = at(v), q = at(v + sub), a = Math.max(along === 'x' ? x0 : y0, Math.min(p, q)), z = Math.min(along === 'x' ? x1 : y1, Math.max(p, q));
      if (z <= a) continue;
      b.fillStyle = i % 2 ? INK : '#efe7d3';
      along === 'x' ? b.fillRect(a, y0, z - a, y1 - y0) : b.fillRect(x0, a, x1 - x0, z - a);
    }
  };
  const X = (lon: number) => proj([lon, centre.lat])![0], Y = (lat: number) => proj([centre.lon, lat])![1];
  band(F, B + 7, W - F, F, 'x', lon0, lon1, X); band(F, H - F, W - F, H - B - 7, 'x', lon0, lon1, X);
  band(B + 7, F, F, H - F, 'y', lat0, lat1, v => Y(v)); band(W - F, F, W - B - 7, H - F, 'y', lat0, lat1, v => Y(v));
  b.strokeStyle = INK; b.lineWidth = .8; b.strokeRect(F, B + 7, W - 2 * F, F - B - 7); b.strokeRect(F, H - F, W - 2 * F, F - B - 7); b.strokeRect(B + 7, F, F - B - 7, H - 2 * F); b.strokeRect(W - F, F, F - B - 7, H - 2 * F);
  b.font = `10.5px ${DIDONE}`; b.fillStyle = INK; b.textAlign = 'center';
  const deg = (v: number, pos: string, neg: string) => { const a = Math.abs(v), d = Math.floor(a + 1e-9), m = Math.round((a - d) * 60); return `${d}°${m ? `${m}′` : ''} ${v >= 0 ? pos : neg}`; };
  for (let v = Math.ceil(lon0 / step) * step; v <= lon1; v += step) { const x = X(v); if (x < F + 30 || x > W - F - 30) continue; b.fillText(deg(v, 'E', 'W'), x, B - 6); }
  for (let v = Math.ceil(lat0 / step) * step; v <= lat1; v += step) { const y = Y(v); if (y < F + 30 || y > H - F - 30) continue; b.save(); b.translate(B - 6, y); b.rotate(-Math.PI / 2); b.fillText(deg(v, 'N', 'S'), 0, 0); b.restore(); }
  // scale of kilometres, bottom right
  const mid = proj.invert!([W / 2, H / 2])!, kmPerPx = km({ lon: mid[0], lat: mid[1] }, (([lo, la]) => ({ lon: lo, lat: la }))(proj.invert!([W / 2 + 100, H / 2])!)) / 100;
  const len = nice(kmPerPx * 160), px = len / kmPerPx, sx = W - F - 26 - px, sy = H - F - 30;
  b.fillStyle = 'rgba(239,231,211,.85)'; b.fillRect(sx - 12, sy - 26, px + 24, 46);
  for (let i = 0; i < 4; i++) { b.fillStyle = i % 2 ? '#efe7d3' : INK; b.fillRect(sx + i * px / 4, sy, px / 4, 6); }
  b.strokeStyle = INK; b.lineWidth = .8; b.strokeRect(sx, sy, px, 6);
  b.font = `11px ${DIDONE}`; b.fillStyle = INK; b.textAlign = 'center'; b.fillText('0', sx, sy - 6); b.fillText(`${len.toLocaleString()} km`, sx + px, sy - 6);
  b.font = `italic 11px ${DIDONE}`; b.fillText('Scale of kilometres', sx + px / 2, sy + 18);
  // what moves: the truth first, then each answer in turn
  const truthXY = s.truth.map(p => ({ p, xy: proj([p.lon, p.lat])! }));
  const placed: [number, number][] = [];
  const inside = (a: Sounding) => { const p = proj([a.answer!.lon, a.answer!.lat]); return !!p && p[0] > F + 6 && p[0] < W - F - 6 && p[1] > F + 6 && p[1] < H - F - 6; };
  const marks = s.soundings.filter(a => a.answer && inside(a)).map(a => {
    const [x, y] = proj([a.answer!.lon, a.answer!.lat])!; let lx = x + 34, ly = y - 24;
    for (let t = 0; t < 50 && (placed.some(q => Math.hypot(q[0] - lx, q[1] - ly) < 32) || truthXY.some(q => Math.hypot(q.xy[0] - lx, q.xy[1] - ly) < 40)); t++) { const ang = t * 2.4, rad = 34 + t * 4; lx = x + Math.cos(ang) * rad; ly = y + Math.sin(ang) * rad; }
    placed.push([lx, ly]); return { a, x, y, lx, ly };
  });
  // the cartouche: what this sheet is, bottom left
  b.font = `italic 12.5px ${DIDONE}`; const lines = wrap(b, s.sub, 296);
  const cw = 330, ch = 64 + lines.length * 16, cx = F + 22;
  // bottom left unless answers sit there, then top left
  const inBox = (y0: number) => marks.filter(m => [[m.x, m.y], [m.lx, m.ly]].some(([x, y]) => x > cx - 16 && x < cx + cw + 16 && y > y0 - 16 && y < y0 + ch + 16)).length;
  const low = H - F - 22 - ch, high = F + 22, cy = inBox(low) <= inBox(high) ? low : high;
  b.fillStyle = '#efe7d3'; b.fillRect(cx, cy, cw, ch); b.strokeStyle = INK; b.lineWidth = 1.4; b.strokeRect(cx, cy, cw, ch); b.lineWidth = .6; b.strokeRect(cx + 4, cy + 4, cw - 8, ch - 8);
  b.textAlign = 'center'; b.fillStyle = INK;
  b.font = `500 11px ${DIDONE}`; b.fillText(spaced('A CHART OF ONE NEWS ITEM'), cx + cw / 2, cy + 24);
  b.font = `italic 400 25px ${DIDONE}`; b.fillText(s.title, cx + cw / 2, cy + 52, cw - 30);
  b.font = `italic 12.5px ${DIDONE}`; b.fillStyle = '#4b3f30'; lines.forEach((l, i) => b.fillText(l, cx + cw / 2, cy + 72 + i * 16));

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, t0 = performance.now(), each = 110, lead = s.truth.length && !settled ? 380 : 0;
  let raf = 0;
  const frame = (now: number) => {
    const t = reduce ? 1e9 : now - t0;
    k.clearRect(0, 0, W, H); k.drawImage(base, 0, 0, W, H);
    k.save(); k.beginPath(); k.rect(F, F, W - 2 * F, H - 2 * F); k.clip();
    for (const { p, xy: [x, y] } of truthXY) {
      const q = settled ? 1 : Math.min(1, t / 380), e = 1 - (1 - q) ** 3;
      star(k, x, y, 19 * e);
    }
    marks.forEach((m, i) => {
      const q = i < settled ? 1 : Math.max(0, Math.min(1, (t - lead - (i - settled) * each) / 420)); if (q <= 0) return;
      const e = 1 - (1 - q) ** 3;
      if (q < 1) { k.beginPath(); k.arc(m.x, m.y, 4 + q * 26, 0, 7); k.strokeStyle = `rgba(36,28,20,${(1 - q) * .7})`; k.lineWidth = 1.2; k.stroke(); }
      k.strokeStyle = INK; k.lineWidth = .9; k.beginPath(); k.moveTo(m.x, m.y); k.lineTo(m.x + (m.lx - m.x) * e, m.y + (m.ly - m.y) * e); k.stroke();
      k.beginPath(); k.arc(m.x, m.y, 4.5, 0, 7); k.fillStyle = m.a.control ? LAND : INK; k.fill(); k.stroke();
      if (q > .5) { const z = (q - .5) * 2; k.beginPath(); k.arc(m.lx, m.ly, 14 * z, 0, 7); k.fillStyle = LAND; k.fill(); k.stroke(); if (z > .8) { k.fillStyle = INK; k.font = `500 15px ${DIDONE}`; k.textAlign = 'center'; k.fillText(String(m.a.n), m.lx, m.ly + 5); } }
    });
    // the truth's name goes on last, over everything, with a halo of paper so it always reads
    if (settled || t >= 380) for (const { p, xy: [x, y] } of truthXY) { k.font = `italic 600 15px ${DIDONE}`; k.textAlign = 'left'; const lab = spaced(p.name.toUpperCase(), .5); k.lineJoin = 'round'; k.strokeStyle = 'rgba(242,234,214,.92)'; k.lineWidth = 5; k.strokeText(lab, x + 24, y - 16); k.fillStyle = RED; k.fillText(lab, x + 24, y - 16); }
    k.restore();
    if (t < lead + (marks.length - settled) * each + 500) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { proj, stop: () => cancelAnimationFrame(raf), far: s.soundings.filter(a => a.answer && !marks.some(m => m.a === a)) };
}

function star(k: CanvasRenderingContext2D, x: number, y: number, R: number) {
  if (R <= 0) return;
  k.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? R * .37 : R; i ? k.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : k.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  k.closePath(); k.fillStyle = RED; k.fill(); k.strokeStyle = INK; k.lineWidth = .8; k.stroke();
}

// a compass rose of 32 points, the cardinal ones long and half-shaded, like an engraved chart's
function rose(k: CanvasRenderingContext2D, x: number, y: number, R: number) {
  k.save(); k.translate(x, y);
  k.strokeStyle = INK; k.lineWidth = .7;
  k.beginPath(); k.arc(0, 0, R * .98, 0, 7); k.stroke(); k.beginPath(); k.arc(0, 0, R * .9, 0, 7); k.stroke();
  for (let i = 0; i < 128; i++) { const a = i / 128 * Math.PI * 2, r0 = R * (i % 4 ? .93 : .9); k.beginPath(); k.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); k.lineTo(Math.cos(a) * R * .98, Math.sin(a) * R * .98); k.stroke(); }
  const point = (a: number, len: number, wid: number) => {
    const tip = [Math.cos(a) * len, Math.sin(a) * len], l = [Math.cos(a - Math.PI / 2) * wid, Math.sin(a - Math.PI / 2) * wid], r = [Math.cos(a + Math.PI / 2) * wid, Math.sin(a + Math.PI / 2) * wid];
    k.beginPath(); k.moveTo(0, 0); k.lineTo(l[0], l[1]); k.lineTo(tip[0], tip[1]); k.closePath(); k.fillStyle = '#efe7d3'; k.fill(); k.stroke();
    k.beginPath(); k.moveTo(0, 0); k.lineTo(r[0], r[1]); k.lineTo(tip[0], tip[1]); k.closePath(); k.fillStyle = INK; k.fill(); k.stroke();
  };
  for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2 - Math.PI / 2; if (i % 8) point(a, R * (i % 4 ? .5 : i % 2 ? .4 : .66), R * .05); }
  for (let i = 0; i < 4; i++) point(i / 4 * Math.PI * 2 - Math.PI / 2, R * .86, R * .1);
  k.font = `italic 600 ${Math.round(R * .3)}px ${DIDONE}`; k.fillStyle = INK; k.textAlign = 'center'; k.fillText('N', 0, -R * 1.06);
  k.beginPath(); k.arc(0, 0, R * .06, 0, 7); k.fillStyle = RED; k.fill(); k.stroke();
  k.restore();
}

const spaced = (s: string, gap = 1) => [...s].join(gap >= 1 ? ' ' : ' ');
function wrap(k: CanvasRenderingContext2D, s: string, w: number) { const out: string[] = []; let line = ''; for (const word of s.split(' ')) { const t = line ? `${line} ${word}` : word; if (k.measureText(t).width > w && line) { out.push(line); line = word; } else line = t; } if (line) out.push(line); return out.slice(0, 3); }
function medoid(ps: { lat: number; lon: number }[]) { let best = ps[0], s = Infinity; for (const p of ps) { const t = ps.reduce((n, q) => n + km(p, q), 0); if (t < s) { s = t; best = p; } } return best; }
