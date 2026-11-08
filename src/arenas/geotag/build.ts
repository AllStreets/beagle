// Build the geotagging arena from Wikipedia's Current Events (CC BY-SA). Each item links the
// places it happened; Wikidata (CC0) gives their coordinates. The labelled days are split by
// date into breeding, race and a sealed test; the pool is unlabelled days for teaching fossils.
import { createHash } from 'node:crypto';
import { open } from '../../store.ts';
import { cachedJson } from '../../http.ts';
import { parseDay, hidePlaces, type Item } from './parse.ts';

const WP = 'https://en.wikipedia.org/w/api.php';
const WD = 'https://www.wikidata.org/w/api.php';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Classes that make an entity a place, when it has no population to say so
const PLACE_CLASSES = new Set(['Q6256', 'Q3624078', 'Q515', 'Q486972', 'Q1549591', 'Q5119', 'Q10864048', 'Q13220204', 'Q23442', 'Q82794', 'Q35657', 'Q34876', 'Q28575', 'Q15284', 'Q3957', 'Q532', 'Q1637706', 'Q123705', 'Q7930989', 'Q112099']);

export type BuildOptions = { from: string; to: string; sealedFrom: string; poolFrom: string; poolTo: string; breedingShare?: number; log?: (s: string) => void };
type Place = { name: string; qid: string; lat: number; lon: number; pop: number; within: string[] };

const days = (from: string, to: string) => { const out: string[] = []; for (let d = new Date(from + 'T00:00:00Z'); d <= new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };
const pageTitle = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `Portal:Current events/${y} ${MONTHS[m - 1]} ${d}`; };
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const sameText = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

async function fetchDays(dates: string[], log: (s: string) => void) {
  const out = new Map<string, string>();
  for (const [i, batch] of chunks(dates, 50).entries()) {
    const url = `${WP}?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&titles=${encodeURIComponent(batch.map(pageTitle).join('|'))}`;
    const r = await cachedJson<{ query: { pages: { title: string; missing?: boolean; revisions?: { slots: { main: { content: string } } }[] }[] } }>(url);
    for (const p of r.query.pages) { const iso = batch.find(d => pageTitle(d) === p.title); if (iso && p.revisions) out.set(iso, p.revisions[0].slots.main.content); }
    log(`  days ${Math.min((i + 1) * 50, dates.length)} of ${dates.length}`);
  }
  return out;
}

async function resolvePlaces(titles: string[], log: (s: string) => void): Promise<Map<string, Place>> {
  const qid = new Map<string, string>();
  for (const batch of chunks(titles, 50)) {
    const r = await cachedJson<any>(`${WP}?action=query&prop=pageprops&ppprop=wikibase_item&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(batch.join('|'))}`);
    const via = new Map<string, string>();
    for (const n of [...(r.query?.normalized ?? []), ...(r.query?.redirects ?? [])]) via.set(n.from, n.to);
    const byTitle = new Map((r.query?.pages ?? []).filter((p: any) => p.pageprops?.wikibase_item).map((p: any) => [p.title, p.pageprops.wikibase_item]));
    for (const t of batch) { let x = t; for (let i = 0; i < 3 && via.has(x); i++) x = via.get(x)!; const q = byTitle.get(x); if (q) qid.set(t, q as string); }
  }
  const ent = new Map<string, any>();
  const ids = [...new Set(qid.values())];
  for (const [i, batch] of chunks(ids, 50).entries()) {
    const r = await cachedJson<any>(`${WD}?action=wbgetentities&props=claims&format=json&ids=${batch.join('|')}`);
    for (const [id, e] of Object.entries(r.entities ?? {})) ent.set(id, e);
    if (i % 10 === 0) log(`  places ${Math.min((i + 1) * 50, ids.length)} of ${ids.length}`);
  }
  const vals = (e: any, p: string) => (e?.claims?.[p] ?? []).map((c: any) => c.mainsnak?.datavalue?.value).filter(Boolean);
  const places = new Map<string, Place>();
  for (const [title, q] of qid) {
    const e = ent.get(q); const coord = vals(e, 'P625')[0];
    if (!coord) continue;
    const pop = Number(String(vals(e, 'P1082')[0]?.amount ?? '0').replace('+', '')) || 0;
    const classes: string[] = vals(e, 'P31').map((v: any) => v.id);
    if (!pop && !classes.some(c => PLACE_CLASSES.has(c))) continue;
    places.set(title, { name: title, qid: q, lat: coord.latitude, lon: coord.longitude, pop, within: [...vals(e, 'P17'), ...vals(e, 'P131')].map((v: any) => v.id) });
  }
  return places;
}

// The truth for an item: its linked places, minus any that only contain another of them
// (Germany, when Mannheim is named), so an answer cannot win by naming the country.
function truthOf(links: string[], places: Map<string, Place>) {
  const here = links.map(l => places.get(l)).filter((p): p is Place => !!p);
  const containers = new Set(here.flatMap(p => p.within));
  return here.filter(p => !containers.has(p.qid)).map(p => ({ name: p.name, qid: p.qid, lat: p.lat, lon: p.lon }));
}

export async function buildGeotag(o: BuildOptions): Promise<{ counts: Record<string, number>; hash: string }> {
  const log = o.log ?? (() => {});
  const labelled = days(o.from, o.to), pool = days(o.poolFrom, o.poolTo);
  log('Fetching Current Events pages...');
  const pages = await fetchDays([...labelled, ...pool], log);
  const parsed = new Map([...pages].map(([d, w]) => [d, parseDay(w)]));
  const titles = [...new Set([...parsed.values()].flat().flatMap(i => i.links))];
  log(`Resolving ${titles.length} linked articles...`);
  const places = await resolvePlaces(titles, log);

  const before = labelled.filter(d => d < o.sealedFrom && parsed.has(d));
  const cut = Math.max(1, Math.round(before.length * (o.breedingShare ?? .75)));
  const splitOf = (d: string) => d >= o.sealedFrom ? 'sealed' : before.indexOf(d) < cut ? 'breeding' : 'race';
  type Row = { id: string; split: string; text: string; hidden: string; date: string; links: string[]; truth: ReturnType<typeof truthOf> | null };
  // every linked place is hidden, the countries that contain the truth included
  const hide = (it: Item) => hidePlaces(it, new Set(it.links.filter(l => places.has(l))));
  const rows: Row[] = [];
  for (const d of labelled) for (const it of parsed.get(d) ?? []) {
    const truth = truthOf(it.links, places); if (!truth.length) continue;
    rows.push({ id: '', split: splitOf(d), text: it.text, hidden: hide(it), date: d, links: it.links, truth });
  }
  const sealedTexts = new Set(rows.filter(r => r.split === 'sealed').map(r => sameText(r.text)));
  for (const d of pool) for (const it of parsed.get(d) ?? []) {
    if (!truthOf(it.links, places).length || sealedTexts.has(sameText(it.text))) continue;
    rows.push({ id: '', split: 'pool', text: it.text, hidden: hide(it), date: d, links: it.links, truth: null });
  }
  // one row per item per day, even if a day repeats a line
  const seen = new Set<string>();
  const unique = rows.filter(r => { r.id = createHash('sha1').update(r.date + '\n' + r.text).digest('hex').slice(0, 16); return !seen.has(r.id) && seen.add(r.id); });

  const hash = createHash('sha256').update(unique.map(r => `${r.id}|${r.split}|${r.text}|${r.hidden}|${JSON.stringify(r.truth)}`).sort().join('\n')).digest('hex');
  const db = open();
  db.exec('begin');
  db.prepare(`delete from tasks where arena = 'geotag'`).run();
  const put = db.prepare('insert into tasks (id, arena, split, input, truth, meta) values (?, ?, ?, ?, ?, ?)');
  for (const r of unique) put.run(r.id, 'geotag', r.split, JSON.stringify({ text: r.text, hidden: r.hidden, date: r.date }), r.truth ? JSON.stringify({ places: r.truth }) : null, JSON.stringify({ date: r.date, links: r.links }));
  db.prepare(`insert or replace into arenas (id, name, version, hash, built_at) values ('geotag', 'Geotagging headlines', ?, ?, ?)`).run(`${o.from}..${o.to}; sealed from ${o.sealedFrom}; pool ${o.poolFrom}..${o.poolTo}`, hash, new Date().toISOString());
  db.exec('commit');
  const counts: Record<string, number> = { breeding: 0, race: 0, sealed: 0, pool: 0 };
  for (const r of unique) counts[r.split]++;
  return { counts, hash };
}
