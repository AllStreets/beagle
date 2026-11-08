import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-race-'));
process.env.BEAGLE_BACKOFF_MS = '5';

let M: typeof import('../src/models/index.ts'), R: typeof import('../src/race.ts'), S: typeof import('../src/stats.ts'), B: typeof import('../src/bundle.ts');
let store: typeof import('../src/store.ts');
const g = (id: string, model = 'claude:claude-haiku-4-5') => ({ id, name: id, model, instructions: 'Answer.', tools: [], workflow: { shape: 'single' as const }, memory: { examples: 0 } });

before(async () => {
  M = await import('../src/models/index.ts'); R = await import('../src/race.ts'); S = await import('../src/stats.ts'); B = await import('../src/bundle.ts');
  store = await import('../src/store.ts');
  const db = store.open();
  const put = db.prepare('insert into tasks (id, arena, split, input, truth, meta) values (?, ?, ?, ?, ?, ?)');
  // ten race tasks all truly at (10, 10); breeding and sealed tasks elsewhere
  for (let i = 0; i < 10; i++) put.run(`r${i}`, 'geotag', 'race', JSON.stringify({ text: `race item ${i}`, date: '2024-06-01' }), JSON.stringify({ places: [{ name: 'X', lat: 10, lon: 10 }] }), '{}');
  for (let i = 0; i < 5; i++) put.run(`b${i}`, 'geotag', 'breeding', JSON.stringify({ text: `breeding item ${i}`, date: '2024-01-01' }), JSON.stringify({ places: [{ name: 'Y', lat: 20, lon: 20 }] }), '{}');
  for (let i = 0; i < 5; i++) put.run(`s${i}`, 'geotag', 'sealed', JSON.stringify({ text: `sealed item ${i}`, date: '2025-05-01' }), JSON.stringify({ places: [{ name: 'Z', lat: 30, lon: 30 }] }), '{}');
});
afterEach(() => M.setDriver(null));

// genome "good" answers exactly; "bad" answers 3,000 km away; each Claude call costs $0.10
const answers = (cost = .1) => M.setDriver(async (_p, name, turns) => {
  const sys = turns[0].content;
  const text = sys.includes('SEALED') ? 'x' : '{"action":"answer","answer":{"lat":10,"lon":10}}';
  return { text: name === 'bad' ? '{"action":"answer","answer":{"lat":-17,"lon":10}}' : text, usd: cost, ms: 4 };
});

test('a voyage records the sealed fingerprint before anything runs, and it changes if a sealed task does', () => {
  const v = R.startVoyage('geotag', { raceTasks: 10 });
  assert.match(v.sealed_hash, /^[0-9a-f]{64}$/);
  assert.equal(v.sealed_hash, R.sealedHash('geotag'));
  store.open().prepare(`update tasks set truth = ? where id = 's0'`).run(JSON.stringify({ places: [{ name: 'Z', lat: 31, lon: 30 }] }));
  assert.notEqual(R.sealedHash('geotag'), v.sealed_hash);
  store.open().prepare(`update tasks set truth = ? where id = 's0'`).run(JSON.stringify({ places: [{ name: 'Z', lat: 30, lon: 30 }] }));
});

test('a race scores every genome on the same tasks, with intervals and a Pareto rank', async () => {
  answers();
  const v = R.startVoyage('geotag', { raceTasks: 10, capGeneration: 100 });
  const r = await R.race(v.id, 0, [g('good'), g('bad', 'claude:bad')], { baselines: false });
  assert.equal(r.complete, true);
  assert.equal(r.common.length, 10);
  const good = r.scores.find(s => s.genome === 'good')!, bad = r.scores.find(s => s.genome === 'bad')!;
  assert.equal(good.mean, 1); assert.equal(bad.mean, 0);
  assert.ok(good.lo <= good.mean && good.mean <= good.hi);
  assert.equal(good.pareto, 1);
});

test('the race stops at the spend cap and compares genomes only on tasks they all finished', async () => {
  answers(.1);
  const v = R.startVoyage('geotag', { raceTasks: 10, capGeneration: 0.75, concurrency: 1 });
  const r = await R.race(v.id, 0, [g('good'), g('bad', 'claude:bad')], { baselines: false });
  assert.equal(r.complete, false);
  assert.ok(r.common.length < 10 && r.common.length > 0);
  const db = store.open();
  for (const t of r.common) assert.equal((db.prepare('select count(*) n from runs where voyage = ? and task = ?').get(v.id, t) as { n: number }).n, 2);
});

test('a usage limit is waited out and retried, never scored, and a resumed race skips finished runs', async () => {
  let calls = 0, limited = 0;
  M.setDriver(async () => { calls++; if (calls % 4 === 0 && limited < 3) { limited++; throw new M.LimitError('usage limit reached'); } return { text: '{"action":"answer","answer":{"lat":10,"lon":10}}', usd: .01, ms: 2 }; });
  const v = R.startVoyage('geotag', { raceTasks: 10, capGeneration: 100 });
  const r = await R.race(v.id, 0, [g('good')], { baselines: false });
  assert.equal(r.complete, true);
  assert.equal(r.scores[0].mean, 1, 'no zero was stored for a limited call');
  const before = calls;
  await R.race(v.id, 0, [g('good')], { baselines: false });
  assert.equal(calls, before, 'nothing ran twice');
});

test('worked examples come only from the breeding split', () => {
  const v = R.startVoyage('geotag', { raceTasks: 10 });
  const ex = R.examplesFor(v.id);
  assert.ok(ex.length > 0);
  for (const e of ex) assert.match(JSON.stringify(e.input), /breeding item/);
});

test('bootstrap intervals are fixed by the seed', () => {
  const xs = [0, .2, .5, .5, .9, 1, 1, .3, .7, .4];
  assert.deepEqual(S.bootstrap(xs, 7), S.bootstrap(xs, 7));
  const { lo, hi } = S.bootstrap(xs, 7);
  assert.ok(lo < .55 && hi > .55 && lo >= 0 && hi <= 1);
  assert.deepEqual(S.bootstrap([1, 1, 1], 1), { lo: 1, hi: 1 });
});

test('Pareto ranks: better on every axis is rank 1; a trade-off shares a rank', () => {
  assert.deepEqual(S.pareto([{ mean: .9, usd: 1, ms: 10 }, { mean: .8, usd: .1, ms: 10 }, { mean: .7, usd: 2, ms: 20 }]), [1, 1, 2]);
});

test('a bundle re-grades to exactly the same scores with no model calls', async () => {
  answers();
  const v = R.startVoyage('geotag', { raceTasks: 10, capGeneration: 100 });
  const r = await R.race(v.id, 0, [g('good'), g('bad', 'claude:bad')], { baselines: false });
  M.setDriver(async () => { throw new Error('regrade must not call a model'); });
  const again = B.regrade(B.exportBundle(v.id));
  assert.deepEqual(again.scores.map(s => [s.genome, s.mean, s.lo, s.hi]), r.scores.map(s => [s.genome, s.mean, s.lo, s.hi]));
});

test('the sealed score is refused until the voyage is finished', async () => {
  const v = R.startVoyage('geotag', { raceTasks: 10 });
  await assert.rejects(R.sealedScore(v.id, ['good']), /not finished/);
});

test('baselines race alongside on the same tasks', async () => {
  answers();
  const v = R.startVoyage('geotag', { raceTasks: 10, capGeneration: 100 });
  const r = await R.race(v.id, 0, [g('good')], { baselines: true });
  const names = r.scores.map(s => s.genome);
  for (const b of ['baseline:random point', 'baseline:gazetteer alone', 'baseline:one Claude call']) assert.ok(names.includes(b), `missing ${b}`);
});
