import type { Arena } from '../types.ts';
import { grade, type Truth } from './grade.ts';
import { lookup } from './gazetteer.ts';

export const geotag: Arena = {
  id: 'geotag',
  name: 'Geotagging headlines',
  describe: 'You are given one news item from Wikipedia\'s Current Events, with its date. Say where on Earth it happened, as a latitude and longitude. Answers within 25 km score full marks; the score falls with distance to nothing at 2,500 km.',
  answer: { type: 'object', required: ['lat', 'lon'], properties: { lat: { type: 'number', minimum: -90, maximum: 90 }, lon: { type: 'number', minimum: -180, maximum: 180 } } },
  grade: (answer, truth) => grade(answer, truth as Truth),
  show: input => { const i = input as { text: string; date: string }; return `${i.date}\n${i.text}`; },
  tools: [{
    name: 'lookup_place',
    describe: 'Look a place name up in an offline gazetteer of towns of 1,000 people or more, regions and countries. Returns up to 8 matches, best first, each with its country code, region, coordinates and population. Narrow by a two-letter country code if you know it.',
    args: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, country: { type: 'string', description: 'two-letter ISO country code' } } },
    run: (a: { name?: string; country?: string }) => ({ matches: lookup(String(a?.name ?? ''), { country: a?.country }).map(p => ({ name: p.name, kind: p.kind, region: p.admin1, country: p.country, lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4), population: p.population })) }),
  }],
};
