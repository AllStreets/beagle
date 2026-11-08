import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-geotag-'));
const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'current-events-2025-03-03.wikitext'), 'utf8');

test('a day of Current Events becomes plain news items with their links', async () => {
  const { parseDay } = await import('../src/arenas/geotag/parse.ts');
  const items = parseDay(fixture);
  assert.ok(items.length >= 8, `only ${items.length} items`);
  const mannheim = items.find(i => i.text.includes('Mannheim'))!;
  assert.equal(mannheim.text, 'A car drives into a crowd of people near a Carnival market in Mannheim, Germany, killing two people and injuring 25 others, including fifteen seriously. A man has been arrested.');
  assert.ok(mannheim.links.includes('Mannheim') && mannheim.links.includes('Germany'));
  for (const i of items) assert.doesNotMatch(i.text, /\[|\]|\{|\}|https?:|''/, i.text);
  // a line that is only a topic link is a heading for the items under it, not an item
  assert.ok(!items.some(i => i.text === 'Russian invasion of Ukraine'));
});

test('the grade is 1 within 25 km and falls smoothly to 0 at 2,500 km', async () => {
  const { grade, km } = await import('../src/arenas/geotag/grade.ts');
  const truth = { places: [{ name: 'Mannheim', lat: 49.4891, lon: 8.4669 }] };
  const at = (d: number) => ({ lat: 49.4891 + d / 111.2, lon: 8.4669 }); // d km due north
  assert.equal(grade(at(0), truth), 1);
  assert.equal(grade(at(25), truth), 1);
  assert.ok(Math.abs(grade(at(250), truth) - 0.5) < 0.01);
  assert.equal(grade(at(2600), truth), 0);
  assert.ok(Math.abs(km({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111.19) < 0.1);
  // the nearest true place counts
  const two = { places: [{ name: 'A', lat: 0, lon: 0 }, { name: 'B', lat: 10, lon: 10 }] };
  assert.equal(grade({ lat: 10, lon: 10 }, two), 1);
  // anything that is not a point scores 0
  for (const bad of [null, {}, { lat: 'x', lon: 1 }, { lat: 91, lon: 0 }, { lat: 0, lon: 200 }]) assert.equal(grade(bad, truth), 0);
});

// A tiny fake Wikipedia and Wikidata: four days, two places each
const DAYS: Record<string, string> = {
  '2024 January 1': '*A bridge collapses in [[Mannheim]], [[Germany]]. [https://x.example (X)]\n*Heavy floods close the port and schools in [[Haifa]]. [https://x.example (X)]',
  '2024 January 2': '*A festival opens in [[Haifa]], [[Israel]]. [https://x.example (X)]',
  '2024 January 3': '*Snow closes roads in [[Mannheim]]. [https://x.example (X)]',
  '2024 January 4': '*A bridge collapses in [[Mannheim]], [[Germany]]. [https://x.example (X)]\n*Early elections are called for the spring in [[Israel]].',
};
const QID: Record<string, string> = { Mannheim: 'Q2119', Germany: 'Q183', Haifa: 'Q41621', Israel: 'Q801' };
const ENT: Record<string, object> = {
  Q2119: { lat: 49.48, lon: 8.47, pop: 300000, country: 'Q183' },
  Q183: { lat: 51, lon: 10, pop: 83000000 },
  Q41621: { lat: 32.8, lon: 35, pop: 280000, country: 'Q801' },
  Q801: { lat: 31, lon: 35, pop: 9000000 },
};
let calls = 0;
const fakeFetch = async (url: string) => {
  calls++;
  const u = new URL(url), titles = (u.searchParams.get('titles') ?? '').split('|'), ids = (u.searchParams.get('ids') ?? '').split('|');
  if (u.searchParams.get('prop') === 'revisions') return { query: { pages: titles.map(t => { const day = t.replace('Portal:Current events/', ''); return DAYS[day] ? { title: t, revisions: [{ slots: { main: { content: DAYS[day] } } }] } : { title: t, missing: true }; }) } };
  if (u.searchParams.get('prop') === 'pageprops') return { query: { pages: titles.map(t => QID[t] ? { title: t, pageprops: { wikibase_item: QID[t] } } : { title: t, missing: true }) } };
  if (u.searchParams.get('action') === 'wbgetentities') return { entities: Object.fromEntries(ids.map(id => { const e = ENT[id] as any; return [id, { id, claims: {
    P625: [{ mainsnak: { datavalue: { value: { latitude: e.lat, longitude: e.lon } } } }],
    P1082: [{ mainsnak: { datavalue: { value: { amount: `+${e.pop}` } } } }],
    ...(e.country ? { P17: [{ mainsnak: { datavalue: { value: { id: e.country } } } }] } : {}),
  } }]; })) };
  throw new Error(`unexpected ${url}`);
};

test('the arena splits by date, keeps the pool apart from the sealed test, and resumes from cache', async () => {
  const http = await import('../src/http.ts');
  const { buildGeotag } = await import('../src/arenas/geotag/build.ts');
  const { open } = await import('../src/store.ts');
  http.setFetch(fakeFetch);
  const r = await buildGeotag({ from: '2024-01-01', to: '2024-01-03', sealedFrom: '2024-01-03', poolFrom: '2024-01-04', poolTo: '2024-01-04', breedingShare: .5 });
  assert.deepEqual(r.counts, { breeding: 2, race: 1, sealed: 1, pool: 2 });
  const rows = open().prepare(`select split, input, truth from tasks where arena = 'geotag'`).all() as { split: string; input: string; truth: string | null }[];
  // a country that contains another linked place is not a truth: Mannheim, not Germany
  const bridge = rows.find(x => x.split === 'breeding' && x.input.includes('bridge'))!;
  assert.deepEqual(JSON.parse(bridge.truth!).places.map((p: { name: string }) => p.name), ['Mannheim']);
  // the pool day repeats a sealed item's text? not here; but it repeats a breeding one, which is fine; it never shares with sealed
  const sealedTexts = new Set(rows.filter(x => x.split === 'sealed').map(x => JSON.parse(x.input).text));
  assert.ok(rows.filter(x => x.split === 'pool').every(x => !sealedTexts.has(JSON.parse(x.input).text)));
  assert.ok(rows.filter(x => x.split === 'pool').every(x => x.truth === null), 'the pool is unlabelled');
  // a rebuild with a warm cache makes no network calls
  http.setFetch(async () => { throw new Error('no network'); });
  const again = await buildGeotag({ from: '2024-01-01', to: '2024-01-03', sealedFrom: '2024-01-03', poolFrom: '2024-01-04', poolTo: '2024-01-04', breedingShare: .5 });
  assert.equal(again.hash, r.hash);
  http.setFetch(null);
});

test('a pool item that repeats a sealed item is dropped', async () => {
  const http = await import('../src/http.ts');
  const { buildGeotag } = await import('../src/arenas/geotag/build.ts');
  http.setFetch(fakeFetch);
  // the pool day (Jan 1) repeats Jan 4's bridge item word for word, and Jan 4 is sealed
  const r = await buildGeotag({ from: '2024-01-02', to: '2024-01-04', sealedFrom: '2024-01-04', poolFrom: '2024-01-01', poolTo: '2024-01-01', breedingShare: .5 });
  assert.equal(r.counts.pool, 1, 'the Haifa floods item stays, the repeated bridge item goes');
  http.setFetch(null);
});

test('the arena tells an agent the task, takes a point as the answer, and offers the gazetteer', async () => {
  const { geotag } = await import('../src/arenas/geotag/index.ts');
  assert.equal(geotag.id, 'geotag');
  assert.match(geotag.show({ text: 'A car drives into a crowd in Mannheim, Germany.', date: '2025-03-03' }), /2025-03-03[\s\S]*Mannheim/);
  assert.deepEqual(geotag.tools.map(t => t.name), ['lookup_place']);
  // the tool answers even when the gazetteer has nothing, and trims what it returns
  const r = await geotag.tools[0].run({ name: 'Nowhereville' }) as { matches: unknown[] };
  assert.deepEqual(r.matches, []);
  assert.equal(geotag.grade({ lat: 49.49, lon: 8.47 }, { places: [{ name: 'Mannheim', lat: 49.4891, lon: 8.4669 }] }), 1);
});
