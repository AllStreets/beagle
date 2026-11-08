import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-gaz-'));
const fixture = join(import.meta.dirname, 'fixtures', 'geonames');
let g: typeof import('../src/arenas/geotag/gazetteer.ts');

before(async () => {
  g = await import('../src/arenas/geotag/gazetteer.ts');
  g.buildGazetteer({ cities: join(fixture, 'cities.tsv'), admin1: join(fixture, 'admin1.tsv'), countries: join(fixture, 'countries.tsv') });
});

test('a name with two places returns both, the larger first', () => {
  const r = g.lookup('Kalat');
  assert.deepEqual(r.map(p => p.country), ['PK', 'AF']);
  assert.equal(r[0].admin1, 'Balochistan');
});

test('a country narrows the matches', () => {
  const r = g.lookup('Kalat', { country: 'AF' });
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'Qalat');
});

test('a name that is nowhere returns nothing, not an error', () => {
  assert.deepEqual(g.lookup('Nowhereville'), []);
  assert.deepEqual(g.lookup(''), []);
  assert.deepEqual(g.lookup('"); drop table places; --'), []);
});

test('accents and case do not matter', () => {
  assert.equal(g.lookup('guimar')[0]?.name, 'Güímar');
  assert.equal(g.lookup('GÜÍMAR')[0]?.name, 'Güímar');
});

test('regions and countries are places too, centred on their towns by population', () => {
  const bal = g.lookup('Balochistan')[0];
  assert.equal(bal.kind, 'admin1');
  assert.equal(bal.country, 'PK');
  // Quetta is far larger than Kalat, so Balochistan's centre sits near Quetta
  assert.ok(Math.abs(bal.lat - 30.18) < 0.4 && Math.abs(bal.lon - 67.0) < 0.2, `${bal.lat},${bal.lon}`);
  const de = g.lookup('Germany')[0];
  assert.equal(de.kind, 'country');
});

test('an exact name beats a larger place that only shares a word', () => {
  // "Haifa" is both a city and a district; the city, an exact match with its own coordinates, comes first
  assert.equal(g.lookup('Haifa')[0].kind, 'city');
});

test('a country whose name a small town shares comes first', () => {
  const r = g.lookup('Bolivia');
  assert.equal(r[0].kind, 'country');
  assert.equal(r[0].country, 'BO');
});

test('a region named with a suffix such as Province still matches', () => {
  assert.equal(g.lookup('Balochistan Province')[0]?.name, 'Balochistan');
  assert.equal(g.lookup('Zabul District')[0]?.name, 'Zabul');
});
