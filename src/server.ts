// The local API the cabinet reads from. Only this machine, addressed by name (a page elsewhere
// that rebinds its domain to 127.0.0.1 still sends its own Host), and writes must carry a
// header a cross-origin page cannot send without a preflight this server never grants.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, json } from './store.ts';
import * as ledger from './ledger.ts';
import { startVoyage, race, getVoyage, summarize, type RaceEvent } from './race.ts';
import { getSettings, saveSettings } from './settings.ts';
import { starters } from './arenas/geotag/starters.ts';
import { getArena } from './arenas/index.ts';
import type { Genome } from './genome.ts';

export const PORT = Number(process.env.BEAGLE_PORT ?? 4750);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app', 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };

class Http extends Error { constructor(public status: number, message: string) { super(message); } }
const send = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
async function body(req: IncomingMessage): Promise<any> { let s = ''; for await (const c of req) s += c; try { return s ? JSON.parse(s) : {}; } catch { throw new Http(400, 'the body is not JSON'); } }

// live race events, per voyage, for anyone watching
const listeners = new Map<string, Set<ServerResponse>>();
function broadcast(voyage: string, e: RaceEvent) { for (const res of listeners.get(voyage) ?? []) res.write(`data: ${JSON.stringify(e)}\n\n`); }
const racing = new Set<string>();

const names = () => new Map(starters().map(g => [g.id, g]));
function generation(voyageId: string, n: number) {
  const v = getVoyage(voyageId), db = open();
  const rows = db.prepare('select genome, task, score, status, usd, ms from runs where voyage = ? and generation = ?').all(v.id, n) as { genome: string; task: string; score: number; status: string; usd: number; ms: number }[];
  const genomes = (db.prepare('select id, body, reason, parent_ids from genomes where voyage = ? and generation = ?').all(v.id, n) as { id: string; body: string; reason: string | null; parent_ids: string }[])
    .map(g => { const b = json<Genome>(g.body, null as unknown as Genome); return { id: g.id, name: b.name, model: b.model, genome: b, reason: g.reason, parents: json(g.parent_ids, []) }; });
  const { common, scores } = summarize(rows, v.settings.seed);
  const expected = (genomes.length + 3) * v.settings.raceTasks;
  return { voyage: v.id, generation: n, genomes, scores, common: common.length, runs: rows.length, expected, racing: racing.has(v.id) };
}

// What is installed, for Settings: models, the local model server, and the training environment
function status() {
  const out: Record<string, unknown> = {};
  try { out.claude = JSON.parse(execFileSync('claude', ['auth', 'status'], { encoding: 'utf8', timeout: 10_000 })).loggedIn ? 'signed in' : 'signed out'; } catch { out.claude = 'not found'; }
  const py = join(ROOT, 'trainer', '.venv', 'bin', 'python');
  try { out.trainer = existsSync(py) ? execFileSync(py, ['-c', 'import platform, mlx.core as mx; print(platform.machine())'], { encoding: 'utf8', timeout: 20_000 }).trim() === 'arm64' ? 'ready, native Apple silicon' : 'running under Rosetta; MLX needs a native Python' : 'not set up'; } catch { out.trainer = 'MLX not installed'; }
  return out;
}

type Route = [string, RegExp, (m: RegExpMatchArray, req: IncomingMessage, res: ServerResponse) => unknown];
const routes: Route[] = [
  ['GET', /^\/api\/status$/, async () => {
    const s = status() as Record<string, unknown>;
    try { const r = await fetch(`${process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'}/api/tags`, { signal: AbortSignal.timeout(2000) }); s.ollama = ((await r.json()) as { models: { name: string }[] }).models.map(m => m.name); } catch { s.ollama = 'not running'; }
    return s;
  }],
  ['GET', /^\/api\/settings$/, () => getSettings()],
  ['POST', /^\/api\/settings$/, async (_m, req) => { try { return saveSettings(await body(req)); } catch (e) { throw new Http(400, (e as Error).message); } }],
  ['GET', /^\/api\/arenas\/([^/]+)\/sample$/, m => {
    const a = getArena(m[1]), db = open();
    const counts = Object.fromEntries((db.prepare('select split, count(*) n from tasks where arena = ? group by split').all(a.id) as { split: string; n: number }[]).map(r => [r.split, r.n]));
    const info = db.prepare('select hash, version, built_at from arenas where id = ?').get(a.id) ?? null;
    // a sample from the race split only: the sealed test's contents are never served
    const tasks = (db.prepare(`select id, input, truth from tasks where arena = ? and split = 'race' order by id limit 12`).all(a.id) as { id: string; input: string; truth: string }[]).map(t => ({ id: t.id, input: json(t.input, null), truth: json(t.truth, null) }));
    return { id: a.id, name: a.name, describe: a.describe, counts, info, tasks };
  }],
  ['GET', /^\/api\/voyages$/, () => (open().prepare('select * from voyages order by started_at desc').all() as { id: string; settings: string }[]).map(v => ({ ...v, settings: json(v.settings, {}), spent: ledger.spent(v.id), racing: racing.has(v.id) }))],
  ['POST', /^\/api\/voyages$/, async (_m, req) => { const b = await body(req); const v = startVoyage(b.arena ?? 'geotag', b.raceTasks ? { raceTasks: Number(b.raceTasks) } : {}); return v; }],
  ['GET', /^\/api\/voyages\/([^/]+)$/, m => {
    const v = getVoyage(m[1]), db = open();
    const gens = db.prepare('select generation, count(*) runs, sum(usd) usd from runs where voyage = ? group by generation order by generation').all(v.id);
    return { ...v, spent: ledger.spent(v.id), time: ledger.time(v.id), generations: gens, racing: racing.has(v.id) };
  }],
  ['GET', /^\/api\/voyages\/([^/]+)\/generations\/(-?\d+)$/, m => generation(m[1], Number(m[2]))],
  ['GET', /^\/api\/voyages\/([^/]+)\/runs$/, (m, req) => {
    const u = new URL(req.url ?? '', 'http://x');
    return open().prepare('select id, task, score, status, usd, ms from runs where voyage = ? and generation = ? and genome = ? order by task').all(m[1], Number(u.searchParams.get('generation') ?? 0), u.searchParams.get('genome') ?? '');
  }],
  ['GET', /^\/api\/runs\/([^/]+)$/, m => {
    const r = open().prepare('select * from runs where id = ?').get(m[1]) as Record<string, string> | undefined;
    if (!r) throw new Http(404, 'no such run');
    const t = open().prepare('select id, split, input, truth, meta from tasks where id = ?').get(r.task) as Record<string, string>;
    // a sealed task's truth is only shown once its voyage is finished
    const sealedOpen = t.split !== 'sealed' || getVoyage(r.voyage).status === 'finished';
    return { ...r, answer: json(r.answer, null), trace: json(r.trace, []), task: { id: t.id, split: t.split, input: json(t.input, null), truth: sealedOpen ? json(t.truth, null) : 'sealed', meta: json(t.meta, {}) } };
  }],
  ['GET', /^\/api\/voyages\/([^/]+)\/events$/, (m, _req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': listening\n\n');
    const set = listeners.get(m[1]) ?? new Set(); set.add(res); listeners.set(m[1], set);
    res.on('close', () => set.delete(res));
    return undefined;
  }],
  ['POST', /^\/api\/voyages\/([^/]+)\/race$/, async (m, req, res) => {
    const v = getVoyage(m[1]), b = await body(req);
    if (racing.has(v.id)) throw new Http(409, 'this voyage is already racing');
    racing.add(v.id);
    race(v.id, Number(b.generation ?? 0), starters(), { baselines: b.baselines !== false, onEvent: e => broadcast(v.id, e) })
      .catch(e => broadcast(v.id, { type: 'stopped', generation: Number(b.generation ?? 0), reason: (e as Error).message }))
      .finally(() => racing.delete(v.id));
    send(res, 202, { started: true });
    return undefined;
  }],
];

async function file(res: ServerResponse, p: string) {
  try { await stat(p); res.writeHead(200, { 'content-type': TYPES[extname(p).toLowerCase()] ?? 'application/octet-stream' }); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end(); }
}

export function serve(port = PORT): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.writeHead(403); return res.end(); }
    if (req.method !== 'GET' && req.headers['x-beagle'] !== '1') return send(res, 403, { error: 'writes need the x-beagle header' });
    try {
      for (const [method, re, fn] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) { const out = await fn(m, req, res); if (out !== undefined) send(res, 200, out); return; }
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      const p = join(APP, url.pathname === '/' ? 'index.html' : url.pathname);
      return file(res, p.startsWith(APP) ? p : join(APP, 'index.html'));
    } catch (e) {
      const status = e instanceof Http ? e.status : /^no (voyage|arena)/.test((e as Error).message) ? 404 : 500;
      if (!res.headersSent) send(res, status, { error: (e as Error).message });
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) { serve(); console.log(`Beagle on http://127.0.0.1:${PORT}`); }
