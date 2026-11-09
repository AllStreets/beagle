// Findings from the final review, each pinned by a test.
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-review-'));
process.env.BEAGLE_BACKOFF_MS = '5';
let M: typeof import('../src/models/index.ts'), R: typeof import('../src/race.ts'), run: typeof import('../src/runner.ts').run, store: typeof import('../src/store.ts'), L: typeof import('../src/ledger.ts');
const geo = async () => (await import('../src/arenas/geotag/index.ts')).geotag;
const g = (id: string, o: object = {}) => ({ id, name: id, model: 'claude:claude-haiku-4-5', instructions: 'Answer.', tools: [], workflow: { shape: 'single' as const }, memory: { examples: 0 }, ...o });

before(async () => {
  M = await import('../src/models/index.ts'); R = await import('../src/race.ts'); run = (await import('../src/runner.ts')).run; store = await import('../src/store.ts'); L = await import('../src/ledger.ts');
  const put = store.open().prepare('insert into tasks (id, arena, split, input, truth, meta) values (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 4; i++) put.run(`r${i}`, 'geotag', 'race', JSON.stringify({ text: `Floods in Mannheim ${i}`, hidden: `Floods in [place] ${i}`, date: '2024-06-01' }), JSON.stringify({ places: [{ name: 'X', lat: 10, lon: 10 }] }), '{}');
  for (let i = 0; i < 8; i++) put.run(`b${i}`, 'geotag', 'breeding', JSON.stringify({ text: `breeding ${i}`, hidden: `breeding ${i}`, date: '2024-01-01' }), JSON.stringify({ places: [{ name: 'Y', lat: 20, lon: 20 }] }), '{}');
});
afterEach(() => M.setDriver(null));

test('critical: an agent set to see no worked examples sees none', async () => {
  const seen: string[] = [];
  M.setDriver(async (_p, _n, turns) => { seen.push(turns[0].content); return { text: '{"action":"answer","answer":{"lat":1,"lon":1}}', usd: 0, ms: 1 }; });
  const ex = [{ input: { text: 'a', date: 'd' }, truth: { places: [{ name: 'Y', lat: 1, lon: 1 }] } }];
  await run(g('none'), { id: 't', input: { text: 'x', date: 'd' } }, await geo(), { examples: ex });
  assert.doesNotMatch(seen[0], /Worked examples/);
  await run(g('one', { memory: { examples: 1 } }), { id: 't', input: { text: 'x', date: 'd' } }, await geo(), { examples: ex });
  assert.match(seen[1], /Worked examples/);
});

test('important: an answer of the wrong shape is not an answer', async () => {
  M.setDriver(async () => ({ text: '{"action":"answer","answer":{"place":"Mannheim"}}', usd: 0, ms: 1 }));
  const r = await run(g('x'), { id: 't', input: { text: 'x', date: 'd' } }, await geo());
  assert.equal(r.status, 'no-answer');
});

test('important: money paid before a call fails is in the ledger, and a passing fault is retried, not scored zero', async () => {
  let calls = 0;
  M.setDriver(async () => { calls++; if (calls === 2) throw new Error('claude timed out'); if (calls === 4) throw new Error('API Error: 500 overloaded'); return { text: '{"action":"answer","answer":{"lat":10,"lon":10}}', usd: .1, ms: 1 }; });
  const v = R.startVoyage('geotag', { raceTasks: 4, capGeneration: 100, concurrency: 1 });
  const r = await R.race(v.id, 0, [g('a', { workflow: { shape: 'vote', n: 2 } })], { baselines: false });
  assert.equal(r.scores[0].mean, 1, 'the faults were retried, so every item scored');
  // every call that returned was paid for, including vote loops finished before a fault
  assert.ok(Math.abs(L.spentOnGeneration(v.id, 0) - (calls - 2) * .1) < 1e-9, `${L.spentOnGeneration(v.id, 0)} vs ${(calls - 2) * .1}`);
});

test('important: controls see the date, as the agents do', async () => {
  const { baselines } = await import('../src/baselines.ts');
  const seen: string[] = [];
  M.setDriver(async (_p, _n, turns) => { seen.push(turns.map(t => t.content).join('\n')); return { text: '{"action":"answer","answer":{"lat":1,"lon":1}}', usd: 0, ms: 1 }; });
  await baselines('geotag').find(b => b.name === 'one Claude call')!.answer({ id: 't', input: { text: 'Floods in Mannheim', hidden: 'Floods in [place]', date: '2024-06-01' } });
  assert.match(seen[0], /2024-06-01/);
  assert.doesNotMatch(seen[0], /Mannheim/);
});

test('important: with only local models, the designer does not run', async () => {
  const D = await import('../src/designer.ts');
  const v = R.startVoyage('geotag', { raceTasks: 4, localOnly: true });
  M.setDriver(async () => { throw new Error('no model may be called'); });
  await assert.rejects(D.breed(v.id, 0, { children: 2, elites: 1, probe: 2 }), /only models on this Mac/i);
});

test('important: an error reply from Wikipedia is not cached', async () => {
  const http = await import('../src/http.ts');
  let calls = 0;
  http.setFetch(async () => { calls++; return calls === 1 ? { error: { code: 'ratelimited' } } : { query: { pages: [] } }; });
  await assert.rejects(http.cachedJson('https://en.wikipedia.org/w/api.php?x=1'), /ratelimited/);
  assert.deepEqual(await http.cachedJson('https://en.wikipedia.org/w/api.php?x=1'), { query: { pages: [] } });
  http.setFetch(null);
});

test('important: a fossil is judged only on items its teacher ran', async () => {
  const { judgeFossil } = await import('../src/fossil.ts');
  const r = judgeFossil({ predicted: [{ lat: 10, lon: 10 }, { lat: 10, lon: 10 }], truth: [{ places: [{ name: 'A', lat: 10, lon: 10 }] }, { places: [{ name: 'A', lat: 10, lon: 10 }] }], teacherScores: [1, null] });
  assert.equal(r.items, 1, 'the item the teacher never ran is left out');
  assert.equal(r.teacher, 1);
});

test('minor: the race lock cannot be taken twice', async () => {
  const db = store.open();
  db.prepare(`insert into locks (voyage, generation, pid, at) values ('vx', 0, 1, 'x')`).run();   // pid 1 is always alive
  const v = R.startVoyage('geotag', { raceTasks: 4 });
  db.prepare(`update locks set voyage = ? where voyage = 'vx'`).run(v.id);
  M.setDriver(async () => ({ text: '{"action":"answer","answer":{"lat":10,"lon":10}}', usd: 0, ms: 1 }));
  await assert.rejects(R.race(v.id, 0, [g('a')], { baselines: false }), /already racing/);
});

test('a withdrawn voyage refuses to race', async () => {
  const v = R.startVoyage('geotag', { raceTasks: 4 });
  store.open().prepare(`update voyages set status = 'withdrawn' where id = ?`).run(v.id);
  M.setDriver(async () => { throw new Error('no model may be called'); });
  await assert.rejects(R.race(v.id, 0, [g('a')], { baselines: false }), /withdrawn/);
});

test('minor: re-grading a bundle with a task missing reports it, without crashing', async () => {
  const { writeFileSync } = await import('node:fs');
  const { regrade } = await import('../src/bundle.ts');
  const file = join(process.env.BEAGLE_HOME!, 'cut.beagle.json');
  writeFileSync(file, JSON.stringify({ format: 'beagle-bundle-1', voyage: { arena: 'geotag', settings: { seed: 1 } }, tasks: {},
    runs: [{ generation: 0, genome: 'a', task: 'gone', answer: { lat: 1, lon: 1 }, score: .9, status: 'done', usd: 0, ms: 0 }] }));
  const r = await regrade(file);
  assert.equal(r.mismatches, 1, 'an answer that cannot be checked is not a match');
  assert.equal(r.missing, 1);
});

test('a local model that times out is a passing fault, retried, not a crash', () => {
  const e = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  assert.equal(R.passing(e), true);
});
