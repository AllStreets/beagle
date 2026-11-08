// Build the geotagging arena.   npx tsx scripts/build-geotag.ts
import { buildGeotag } from '../src/arenas/geotag/build.ts';
const t0 = Date.now();
const r = await buildGeotag({ from: '2023-01-01', to: '2025-06-30', sealedFrom: '2025-04-01', poolFrom: '2021-01-01', poolTo: '2022-12-31', breedingShare: .75, log: console.log });
console.log(JSON.stringify(r.counts), r.hash, `${Math.round((Date.now() - t0) / 1000)}s`);
