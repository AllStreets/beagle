import type { Arena } from '../types.ts';
import { grade, km, asPoint, type Truth } from './grade.ts';
import { lookup } from './gazetteer.ts';

const SCORING = 'Answers within 25 km score full marks; the score falls with distance to nothing at 2,500 km.';

// The main arena: every place the item names is hidden, so it has to be placed from context
export const geotag: Arena = {
  id: 'geotag',
  data: 'geotag',
  name: 'Where did it happen? (places hidden)',
  describe: `You are given one news item from Wikipedia's Current Events, with its date. Every place it names has been replaced with [place]. Work out where on Earth it happened from everything else in it, and answer with a latitude and longitude. ${SCORING}`,
  answer: { type: 'object', required: ['lat', 'lon'], properties: { lat: { type: 'number', minimum: -90, maximum: 90 }, lon: { type: 'number', minimum: -180, maximum: 180 } } },
  grade: (answer, truth) => grade(answer, truth as Truth),
  inBrowser: true,
  valid: answer => !!asPoint(answer),
  // of several points, the one with the least total distance to the others, so an outlier never
  // wins against answers that agree
  merge: answers => { const pts = answers.map(asPoint).filter((p): p is { lat: number; lon: number } => !!p); if (!pts.length) return null; let best = pts[0], s = Infinity; for (const p of pts) { const t = pts.reduce((n, q) => n + km(p, q), 0); if (t < s) { s = t; best = p; } } return best; },
  example: truth => { const p = (truth as Truth).places?.[0]; return p ? `${JSON.stringify({ lat: p.lat, lon: p.lon })} (${p.name})` : JSON.stringify(truth); },
  miss: (answer, truth) => { const p = asPoint(answer), t = truth as Truth; return `truth: ${t.places.map(q => q.name).join(', ')}; it ${p ? `was ${Math.round(Math.min(...t.places.map(q => km(p, q))))} km off` : 'gave no answer'}`; },
  show: input => { const i = input as { text: string; hidden?: string; date: string }; return `${i.date}\n${i.hidden ?? i.text}`; },
  tools: [{
    name: 'lookup_place',
    describe: 'Look a place name up in an offline gazetteer of towns of 1,000 people or more, regions and countries. Returns up to 8 matches, best first, each with its country code, region, coordinates and population. Narrow by a two-letter country code if you know it.',
    args: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, country: { type: 'string', description: 'two-letter ISO country code' } } },
    run: (a: { name?: string; country?: string }) => ({ matches: lookup(String(a?.name ?? ''), { country: a?.country }).map(p => ({ name: p.name, kind: p.kind, region: p.admin1, country: p.country, lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4), population: p.population })) }),
  }],
};

// The easier variant, on the same tasks: the places are named, so it is mostly a lookup
export const geotagNamed: Arena = {
  ...geotag,
  id: 'geotag-named',
  name: 'Where did it happen? (places named)',
  describe: `You are given one news item from Wikipedia's Current Events, with its date. Say where on Earth it happened, as a latitude and longitude. ${SCORING}`,
  show: input => { const i = input as { text: string; date: string }; return `${i.date}\n${i.text}`; },
};
