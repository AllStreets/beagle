// An offline gazetteer from GeoNames (CC BY 4.0): every town of 1,000 people or more, plus
// regions and countries. Agents look places up by name; nothing leaves the Mac.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../../paths.ts';

export type Place = { name: string; admin1: string; country: string; lat: number; lon: number; population: number; kind: 'city' | 'admin1' | 'country' };

let db: DatabaseSync | null = null;
const file = () => { mkdirSync(paths.arenas, { recursive: true }); return join(paths.arenas, 'gazetteer.db'); };
function open(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(file());
  db.exec(`create table if not exists places (id integer primary key, name text, country text, admin1 text, lat real, lon real, population integer, kind text);
    create table if not exists names (place integer, norm text, primary_name integer);
    create index if not exists names_norm on names(norm);`);
  return db;
}

// Case, accents, curly quotes and spacing do not matter.
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‘’ʼ`]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();

const rows = (path: string) => readFileSync(path, 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('\t'));

export function buildGazetteer(src: { cities: string; admin1: string; countries: string }) {
  const d = open();
  d.exec('delete from places; delete from names; begin');
  const putPlace = d.prepare('insert into places (name, country, admin1, lat, lon, population, kind) values (?, ?, ?, ?, ?, ?, ?)');
  const putName = d.prepare('insert into names (place, norm, primary_name) values (?, ?, ?)');
  const admin1Names = new Map(rows(src.admin1).map(r => [r[0], r[1]]));
  // regions and countries are centred on their towns, weighted by population
  const centre = new Map<string, { lat: number; lon: number; w: number; pop: number }>();
  const add = (key: string, lat: number, lon: number, pop: number) => {
    const w = Math.max(pop, 1), c = centre.get(key) ?? { lat: 0, lon: 0, w: 0, pop: 0 };
    c.lat += lat * w; c.lon += lon * w; c.w += w; c.pop += pop; centre.set(key, c);
  };
  for (const r of rows(src.cities)) {
    const [, name, ascii, alts, lat, lon, , , country, , a1, , , , pop] = r;
    const la = Number(lat), lo = Number(lon), p = Number(pop) || 0;
    const admin1 = admin1Names.get(`${country}.${a1}`) ?? '';
    const id = Number(putPlace.run(name, country, admin1, la, lo, p, 'city').lastInsertRowid);
    const seen = new Set<string>();
    for (const [n, primary] of [[name, 1], [ascii, 1], ...alts.split(',').map(a => [a, 0] as const)] as const) {
      const k = norm(String(n)); if (!k || seen.has(k)) continue; seen.add(k); putName.run(id, k, primary);
    }
    add(`${country}.${a1}`, la, lo, p); add(country, la, lo, p);
  }
  for (const [code, name] of admin1Names) {
    const c = centre.get(code); if (!c) continue;
    const id = Number(putPlace.run(name, code.split('.')[0], name, c.lat / c.w, c.lon / c.w, c.pop, 'admin1').lastInsertRowid);
    putName.run(id, norm(name), 1);
  }
  for (const r of rows(src.countries)) {
    const [iso, , , , name] = r; const c = centre.get(iso); if (!c || !name) continue;
    const id = Number(putPlace.run(name, iso, '', c.lat / c.w, c.lon / c.w, c.pop, 'country').lastInsertRowid);
    putName.run(id, norm(name), 1);
  }
  d.exec('commit');
}

const KIND_ORDER = `case p.kind when 'country' then 0 when 'city' then 1 else 2 end`;
const SUFFIX = / (province|region|district|territory|state|governorate|prefecture|county|oblast|department|municipality)$/;

// Places with this name, best first: an exact primary name before an alternate one, then a
// country (a town called Bolivia is rarely the news), then towns before regions, then the
// larger first. A name ending in a word like Province is tried without it if nothing matches.
export function lookup(name: string, o: { country?: string; limit?: number } = {}): Place[] {
  const k = norm(name ?? ''); if (!k) return [];
  const found = find(k, o);
  return found.length || !SUFFIX.test(k) ? found : find(k.replace(SUFFIX, ''), o);
}
function find(k: string, o: { country?: string; limit?: number }): Place[] {
  const sql = `select p.name, p.admin1, p.country, p.lat, p.lon, p.population, p.kind, max(n.primary_name) prim
    from names n join places p on p.id = n.place where n.norm = ? ${o.country ? 'and p.country = ?' : ''}
    group by p.id order by prim desc, ${KIND_ORDER}, p.population desc limit ?`;
  const args: (string | number)[] = [k]; if (o.country) args.push(o.country.toUpperCase()); args.push(o.limit ?? 8);
  return (open().prepare(sql).all(...args) as (Place & { prim: number })[]).map(({ prim: _p, ...p }) => p);
}
