// Your own arena: a folder with arena.json (its id, name, task and the shape of an answer),
// tasks.jsonl (one { id, input, truth } a line) and grade.ts (a default export that scores an
// answer against a truth from 0 to 1). Beagle copies it into its home, splits it by a hash of
// each task, and races it like any other.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { open } from '../store.ts';
import { paths } from '../paths.ts';
import { registerArena, arenaIds, getArena } from './index.ts';
import { genericStarters, genericControls } from './generic.ts';
import type { Arena } from './types.ts';
import { BUILTIN } from './tools.ts';

type Spec = { id: string; name: string; describe: string; answer: object; maxTurns?: number; tools?: string[] };
const home = () => join(paths.home, 'arenas', 'custom');
const bucket = (id: string) => createHash('sha1').update(id).digest().readUInt32BE(0) % 100;
export const splitOf = (id: string) => bucket(id) < 60 ? 'breeding' : bucket(id) < 85 ? 'race' : 'sealed';

// A custom grader runs in a worker thread: one that loops forever is terminated at its time and a
// fresh worker takes the next grade, so Beagle's own thread never stops.
const WORKER = new URL('./grader-worker.mjs', import.meta.url);
class Grader {
  private w: Worker | null = null; private ready: Promise<void> | null = null; private n = 0;
  private pending = new Map<number, { ok: (s: number) => void; no: (e: Error) => void }>();
  constructor(private url: string, public timeoutMs = 120_000) {}
  private start() {
    const w = new Worker(WORKER, { workerData: { url: this.url }, execArgv: ['--experimental-strip-types', '--no-warnings'] });
    this.w = w;
    this.ready = new Promise((ok, no) => {
      w.on('message', (m: { ready?: boolean; fatal?: string; id?: number; score?: number; error?: string }) => {
        if (m.ready) { this.idle(); return ok(); } if (m.fatal) return no(new Error(m.fatal));
        const p = this.pending.get(m.id!); if (!p) return; this.pending.delete(m.id!);
        m.error !== undefined ? p.no(new Error(m.error)) : p.ok(Number(m.score));
        this.idle();
      });
      w.on('error', (e: Error) => { no(e); this.fail(e); }); w.on('exit', () => { if (this.w === w) { this.w = null; this.fail(new Error('the grader stopped')); } });
    });
    w.ref();   // held while it starts and while it grades; let go once idle (see idle())
    return this.ready;
  }
  // an idle grader never keeps Beagle running; a busy one does, until its answer or its time
  private idle() { if (this.w && !this.pending.size) this.w.unref(); }
  private fail(e: Error) { for (const p of this.pending.values()) p.no(e); this.pending.clear(); }
  async check() { await (this.ready ?? this.start()); }
  async grade(answer: unknown, truth: unknown): Promise<number> {
    if (!this.w) this.start(); await this.ready;
    const id = ++this.n, w = this.w!;
    return new Promise((ok, no) => {
      const t = setTimeout(() => { this.pending.delete(id); this.w = null; w.terminate(); no(new Error('the grader ran out of time')); }, this.timeoutMs);
      this.pending.set(id, { ok: s => { clearTimeout(t); ok(s); }, no: e => { clearTimeout(t); no(e); } });
      w.ref(); w.postMessage({ id, answer, truth });
    });
  }
}

async function load(dir: string): Promise<Arena> {
  const spec = JSON.parse(readFileSync(join(dir, 'arena.json'), 'utf8')) as Spec;
  // a fresh query string, so a changed grader is not served from the module cache
  const grader = new Grader(`${pathToFileURL(join(dir, 'grade.ts')).href}?v=${Date.now()}`);
  await grader.check();
  const grade: Arena['grade'] = (answer, truth) => grader.grade(answer, truth);
  const a: Arena = {
    id: spec.id, data: spec.id, name: spec.name, describe: spec.describe, answer: spec.answer, maxTurns: spec.maxTurns, grade, timesItself: true, tools: (spec.tools ?? []).map(n => { const t = BUILTIN[n]; if (!t) throw new Error(`arena.json asks for a tool Beagle does not have: ${n} (it has ${Object.keys(BUILTIN).join(', ')})`); return t; }),
    show: input => typeof input === 'string' ? input : JSON.stringify(input), kind: 'custom', fromText: text => text,
  };
  a.starters = () => genericStarters(a); a.controls = () => genericControls(a);
  // the arena's time limit is the worker's: past it the worker is ended, not merely ignored
  Object.defineProperty(a, 'graderTimeoutMs', { get: () => grader.timeoutMs, set: (v: number) => { grader.timeoutMs = v; }, enumerable: true });
  return a;
}

export async function addArena(folder: string) {
  const dir = resolve(folder);
  if (!existsSync(join(dir, 'arena.json'))) throw new Error(`${dir} has no arena.json: an arena is a folder with arena.json, tasks.jsonl and grade.ts`);
  for (const f of ['tasks.jsonl', 'grade.ts']) if (!existsSync(join(dir, f))) throw new Error(`${dir} has no ${f}`);
  const spec = JSON.parse(readFileSync(join(dir, 'arena.json'), 'utf8')) as Spec;
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(spec.id ?? '')) throw new Error('arena.json needs an id of lowercase letters, digits and dashes');
  if (!spec.name || !spec.describe || !spec.answer) throw new Error('arena.json needs a name, a describe (the task as an agent is told it) and an answer (a JSON schema)');
  const custom = existsSync(join(home(), spec.id));
  if (arenaIds().includes(spec.id) && !custom) throw new Error(`there is already an arena called "${spec.id}"`);
  const tasks = readFileSync(join(dir, 'tasks.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map((l, i) => { const t = JSON.parse(l); if (!('input' in t) || !('truth' in t)) throw new Error(`tasks.jsonl line ${i + 1} needs an input and a truth`); return { id: String(t.id ?? i), input: t.input, truth: t.truth }; });
  if (tasks.length < 20) throw new Error(`an arena needs at least 20 tasks to split; this one has ${tasks.length}`);
  if (new Set(tasks.map(t => t.id)).size !== tasks.length) throw new Error('every task needs its own id');
  const arena = await load(dir);   // the grader loads, or the arena is refused
  const to = join(home(), spec.id); mkdirSync(home(), { recursive: true }); cpSync(dir, to, { recursive: true });
  const db = open(), counts = { breeding: 0, race: 0, sealed: 0 } as Record<string, number>;
  db.exec('begin');
  try {
    db.prepare('delete from tasks where arena = ?').run(spec.id);
    const put = db.prepare('insert into tasks (id, arena, split, input, truth, meta) values (?, ?, ?, ?, ?, ?)');
    for (const t of tasks) { const split = splitOf(`${spec.id}:${t.id}`); counts[split]++; put.run(`${spec.id}:${t.id}`, spec.id, split, JSON.stringify(t.input), JSON.stringify(t.truth), '{}'); }
    const hash = createHash('sha256').update(tasks.map(t => `${t.id}|${JSON.stringify(t.input)}|${JSON.stringify(t.truth)}`).join('\n')).digest('hex');
    db.prepare('insert or replace into arenas (id, name, version, hash, built_at) values (?, ?, ?, ?, ?)').run(spec.id, spec.name, `custom; ${tasks.length} tasks`, hash, new Date().toISOString());
    db.exec('commit');
  } catch (e) { db.exec('rollback'); throw e; }
  registerArena(await load(to));
  return { id: arena.id, counts: counts as { breeding: number; race: number; sealed: number } };
}

// every custom arena in Beagle's home, registered again after a restart
export async function loadCustomArenas() {
  if (!existsSync(home())) return [];
  const ids: string[] = [];
  for (const d of readdirSync(home())) { try { registerArena(await load(join(home(), d))); ids.push(d); } catch (e) { console.error(`custom arena ${d} did not load: ${(e as Error).message}`); } }
  return ids;
}
export const isCustom = (id: string) => existsSync(join(home(), id)) && !!getArena(id);
