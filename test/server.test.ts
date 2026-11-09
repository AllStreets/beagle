import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';

process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-server-'));
let server: Server, base = '';
const W = { 'x-beagle': '1', 'content-type': 'application/json' };

before(async () => {
  const { open } = await import('../src/store.ts');
  const db = open(), put = db.prepare('insert into tasks (id, arena, split, input, truth, meta) values (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 4; i++) put.run(`r${i}`, 'geotag', 'race', JSON.stringify({ text: `race item ${i}`, date: '2024-06-01' }), JSON.stringify({ places: [{ name: 'X', lat: 10, lon: 10 }] }), '{}');
  put.run('s0', 'geotag', 'sealed', JSON.stringify({ text: 'SECRET sealed item', date: '2025-05-01' }), JSON.stringify({ places: [{ name: 'Z', lat: 30, lon: 30 }] }), '{}');
  put.run('b0', 'geotag', 'breeding', JSON.stringify({ text: 'breeding item', date: '2024-01-01' }), JSON.stringify({ places: [{ name: 'Y', lat: 20, lon: 20 }] }), '{}');
  const M = await import('../src/models/index.ts');
  M.setDriver(async () => ({ text: '{"action":"answer","answer":{"lat":10,"lon":10}}', usd: .01, ms: 2 }));
  const { serve } = await import('../src/server.ts');
  server = serve(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

test('a write without the x-beagle header is refused', async () => {
  const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"seed":2}' });
  assert.equal(r.status, 403);
});

test('a request addressed to another host is refused', async () => {
  // fetch drops a custom Host header, so this goes through http.request, which sends it
  const { request } = await import('node:http');
  const status = await new Promise<number>((ok, fail) => { const r = request(`${base}/api/voyages`, { headers: { host: 'evil.example' } }, res => { res.resume(); ok(res.statusCode!); }); r.on('error', fail); r.end(); });
  assert.equal(status, 403);
});

test('settings are read back as saved, and bad ones refused with a reason', async () => {
  const ok = await fetch(`${base}/api/settings`, { method: 'POST', headers: W, body: JSON.stringify({ capGeneration: 3, view: 'lab' }) });
  assert.equal(ok.status, 200);
  const s = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(s.capGeneration, 3); assert.equal(s.view, 'lab');
  const bad = await fetch(`${base}/api/settings`, { method: 'POST', headers: W, body: JSON.stringify({ capGeneration: 'lots' }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /must be a number/);
});

test('an arena sample never shows a sealed task', async () => {
  const r = await (await fetch(`${base}/api/arenas/geotag/sample`)).json();
  assert.ok(r.tasks.length > 0);
  assert.doesNotMatch(JSON.stringify(r), /SECRET/);
  assert.equal(r.counts.sealed, 1, 'the count of sealed tasks may be shown, never their contents');
});

test('a race started through the API streams each run as it finishes, and its numbers match the generation endpoint', async () => {
  const v = await (await fetch(`${base}/api/voyages`, { method: 'POST', headers: W, body: JSON.stringify({ arena: 'geotag', raceTasks: 4 }) })).json();
  assert.match(v.sealed_hash, /^[0-9a-f]{64}$/);
  const events: any[] = [];
  const stream = await fetch(`${base}/api/voyages/${v.id}/events`);
  const reader = stream.body!.getReader(); const dec = new TextDecoder();
  const reading = (async () => { let buf = ''; for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const line = chunk.split('\n').find(l => l.startsWith('data: ')); if (line) { const e = JSON.parse(line.slice(6)); events.push(e); if (e.type === 'finished' || e.type === 'stopped') return; } } } })();
  const started = await fetch(`${base}/api/voyages/${v.id}/race`, { method: 'POST', headers: W, body: JSON.stringify({ generation: 0, genomes: 'starters', baselines: false }) });
  assert.equal(started.status, 202);
  await reading; await reader.cancel();
  assert.ok(events.filter(e => e.type === 'run').length >= 4);
  const gen = await (await fetch(`${base}/api/voyages/${v.id}/generations/0`)).json();
  const fin = events.find(e => e.type === 'finished');
  assert.deepEqual(gen.scores.map((s: any) => [s.genome, s.mean]), fin.result.scores.map((s: any) => [s.genome, s.mean]));
  assert.ok(gen.genomes.every((g: any) => g.name && g.model), 'each genome comes with its name and model');
  // and any run's trace can be opened
  const runs = await (await fetch(`${base}/api/voyages/${v.id}/runs?generation=0&genome=${encodeURIComponent(gen.scores[0].genome)}`)).json();
  const one = await (await fetch(`${base}/api/runs/${runs[0].id}`)).json();
  assert.ok(Array.isArray(one.trace) && one.task.input.text);
});

test('the telling task: one task every entrant answered, the one their scores spread most on, with every answer', async () => {
  const vs = await (await fetch(`${base}/api/voyages`)).json();
  const v = vs.find((x: any) => x.arena === 'geotag');
  const t = await (await fetch(`${base}/api/voyages/${v.id}/generations/0/telling`)).json();
  assert.ok(t.task.input.text && t.task.truth.places.length);
  const gen = await (await fetch(`${base}/api/voyages/${v.id}/generations/0`)).json();
  assert.equal(t.answers.length, gen.scores.length, 'one answer per entrant');
  for (const a of t.answers) assert.ok('score' in a && 'name' in a);
});

test('a generation lists its tasks with how the field did on each, and any one task opens with every answer', async () => {
  const vs = await (await fetch(`${base}/api/voyages`)).json();
  const v = vs.find((x: any) => x.arena === 'geotag');
  const list = await (await fetch(`${base}/api/voyages/${v.id}/generations/0/tasks`)).json();
  assert.ok(list.length > 0);
  for (const t of list) { assert.ok(t.id && t.shown && typeof t.mean === 'number' && t.answered >= 1); assert.doesNotMatch(JSON.stringify(t), /SECRET/); }
  const one = await (await fetch(`${base}/api/voyages/${v.id}/generations/0/telling?task=${list[0].id}`)).json();
  assert.equal(one.task.id, list[0].id);
  const bad = await fetch(`${base}/api/voyages/${v.id}/generations/0/telling?task=s0`);
  assert.equal(bad.status, 404, 'a sealed task is never opened this way');
});

test('the lineage lists every genome of every generation with its parents and score, and fossils are listed', async () => {
  const vs = await (await fetch(`${base}/api/voyages`)).json();
  const v = vs.find((x: any) => x.arena === 'geotag');
  const l = await (await fetch(`${base}/api/voyages/${v.id}/lineage`)).json();
  assert.ok(l.length >= 1);
  for (const n of l) assert.ok(n.id && n.name && typeof n.generation === 'number' && Array.isArray(n.parents) && 'mean' in n);
  const f = await (await fetch(`${base}/api/voyages/${v.id}/fossils`)).json();
  assert.ok(Array.isArray(f));
});

test('minor: a voyage on local models only expects runs from the controls it really has', async () => {
  const v = await (await fetch(`${base}/api/voyages`, { method: 'POST', headers: W, body: JSON.stringify({ arena: 'geotag', raceTasks: 4, localOnly: true }) })).json();
  const g = await (await fetch(`${base}/api/voyages/${v.id}/generations/0`)).json();
  // the one-Claude-call control is left out on a local-only voyage, so two controls, not three
  assert.equal(g.expected, (g.genomes.length + 2) * 4);
});

test('a malformed path is refused, and the server keeps running', async () => {
  const { request } = await import('node:http');
  const port = (server.address() as { port: number }).port;
  const status = await new Promise<number>((ok, fail) => { const r = request({ host: '127.0.0.1', port, path: '//' }, res => { res.resume(); ok(res.statusCode!); }); r.on('error', fail); r.end(); });
  assert.equal(status, 400);
  assert.equal((await fetch(`${base}/api/settings`)).status, 200);
});

test('a voyage can be fetched whole as a bundle, and re-grading it in any program reproduces the recorded scores; no sealed item is in it', async () => {
  const vs = await (await fetch(`${base}/api/voyages`)).json();
  const v = vs.find((x: any) => x.arena === 'geotag' && x.spent > 0);
  const b = await (await fetch(`${base}/api/voyages/${v.id}/bundle`)).json();
  assert.equal(b.format, 'beagle-bundle-1');
  assert.ok(b.runs.length > 0);
  const { grade } = await import('../src/arenas/geotag/grade.ts');
  for (const r of b.runs) assert.equal(r.status === 'done' ? grade(r.answer, b.tasks[r.task].truth) : 0, r.score);
  assert.doesNotMatch(JSON.stringify(b), /SECRET/);
});

test('the sealed fingerprint is recomputed on request and compared with the one recorded at launch', async () => {
  const vs = await (await fetch(`${base}/api/voyages`)).json();
  const v = vs.find((x: any) => x.arena === 'geotag');
  const s = await (await fetch(`${base}/api/voyages/${v.id}/seal`)).json();
  assert.equal(s.recorded, v.sealed_hash);
  assert.match(s.now, /^[0-9a-f]{64}$/);
  assert.equal(s.match, true);
  assert.equal(s.items, 1);
  assert.doesNotMatch(JSON.stringify(s), /SECRET/);
});

test('your own item: a local agent answers it free; a Claude agent only with consent, and its cost is in the ledger', async () => {
  const vs = await (await fetch(`${base}/api/voyages`)).json();
  const v = vs.find((x: any) => x.arena === 'geotag' && x.spent > 0);
  const { open } = await import('../src/store.ts');
  const db = open();
  const local = { id: 'try-local', name: 'Local one', model: 'ollama:llama3.1:8b', instructions: 'Answer.', tools: [], workflow: { shape: 'single' }, memory: { examples: 0 } };
  const paid = { ...local, id: 'try-paid', name: 'Paid one', model: 'claude:claude-haiku-4-5' };
  for (const g of [local, paid]) db.prepare('insert or replace into genomes (id, voyage, generation, parent_ids, body, reason) values (?, ?, 0, ?, ?, null)').run(g.id, v.id, '[]', JSON.stringify(g));
  const ask = (genome: string, extra = {}) => fetch(`${base}/api/try`, { method: 'POST', headers: W, body: JSON.stringify({ voyage: v.id, genome, text: 'Floods hit [place] after a week of rain.', date: '2026-11-01', ...extra }) });
  const r = await ask('try-local'); assert.equal(r.status, 200);
  const a = await r.json(); assert.deepEqual(a.answer, { lat: 10, lon: 10 }); assert.equal(a.usd, 0); assert.ok(Array.isArray(a.trace));
  const refused = await ask('try-paid'); assert.equal(refused.status, 402);
  assert.match((await refused.json()).error, /costs money/);
  const before = (db.prepare(`select count(*) n from ledger where voyage = ? and kind = 'try'`).get(v.id) as { n: number }).n;
  const ok = await ask('try-paid', { allowPaid: true }); assert.equal(ok.status, 200);
  const after = (db.prepare(`select count(*) n from ledger where voyage = ? and kind = 'try'`).get(v.id) as { n: number }).n;
  assert.equal(after, before + 1);
  const ctl = await (await ask('baseline:gazetteer alone')).json();
  assert.ok('answer' in ctl, 'the free controls answer too');
  const empty = await fetch(`${base}/api/try`, { method: 'POST', headers: W, body: JSON.stringify({ voyage: v.id, genome: 'try-local', text: ' ' }) });
  assert.equal(empty.status, 400);
});
