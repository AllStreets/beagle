// Download GeoNames' towns of 1,000+ people, regions and countries (CC BY 4.0) and build the
// offline gazetteer.   npx tsx scripts/fetch-geonames.ts
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { paths } from '../src/paths.ts';
import { buildGazetteer } from '../src/arenas/geotag/gazetteer.ts';

const BASE = 'https://download.geonames.org/export/dump/';
const UA = 'beagle/0.1 (https://github.com/AllStreets/beagle)';
const dir = join(paths.cache, 'geonames'); mkdirSync(dir, { recursive: true });

for (const f of ['cities1000.zip', 'admin1CodesASCII.txt', 'countryInfo.txt']) {
  const out = join(dir, f);
  if (existsSync(out)) continue;
  console.log(`Downloading ${f}...`);
  const r = await fetch(BASE + f, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
}
if (!existsSync(join(dir, 'cities1000.txt'))) execFileSync('unzip', ['-o', '-q', join(dir, 'cities1000.zip'), '-d', dir]);
console.log('Building the gazetteer...');
buildGazetteer({ cities: join(dir, 'cities1000.txt'), admin1: join(dir, 'admin1CodesASCII.txt'), countries: join(dir, 'countryInfo.txt') });
console.log('Done.');
