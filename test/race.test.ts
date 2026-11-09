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
  const again = await B.regrade(B.exportBundle(v.id));
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

test('two voyages racing the same starters each keep their own genomes', async () => {
  answers();
  const store_ = store.open();
  const v1 = R.startVoyage('geotag', { raceTasks: 2, capGeneration: 100 }), v2 = R.startVoyage('geotag', { raceTasks: 2, capGeneration: 100 });
  await R.race(v1.id, 0, [g('shared')], { baselines: false });
  await R.race(v2.id, 0, [g('shared')], { baselines: false });
  for (const v of [v1, v2]) assert.equal((store_.prepare('select count(*) n from genomes where voyage = ? and id = ?').get(v.id, 'shared') as { n: number }).n, 1, `voyage ${v.id} lost its genome`);
});

test('the controls see the task exactly as the agents do', async () => {
  const { baselines } = await import('../src/baselines.ts');
  const seen: string[] = [];
  M.setDriver(async (_p, _n, turns) => { seen.push(turns.map(t => t.content).join('\n')); return { text: '{"action":"answer","answer":{"lat":1,"lon":1}}', usd: 0, ms: 1 }; });
  const task = { id: 't', input: { text: 'A car drives into a crowd in Mannheim, Germany.', hidden: 'A car drives into a crowd in [place], [place].', date: '2025-03-03' } };
  for (const b of baselines('geotag')) {
    const r = await b.answer(task);
    if (b.name === 'gazetteer alone') assert.equal(r.answer, null, 'with every place hidden there is nothing to look up');
  }
  assert.ok(seen.length && seen.every(s => !s.includes('Mannheim') && s.includes('[place]')), 'Claude was shown the hidden text');
});

test('the count of answers within 25 km is taken on the same tasks as the score', () => {
  const rows = [
    { genome: 'a', task: 't1', score: 1, status: 'done', usd: 0, ms: 1 }, { genome: 'a', task: 't2', score: 1, status: 'done', usd: 0, ms: 1 },
    { genome: 'b', task: 't1', score: 0, status: 'done', usd: 0, ms: 1 },
  ];
  const { common, scores } = R.summarize(rows, 1);
  assert.deepEqual(common, ['t1']);
  assert.equal(scores.find(s => s.genome === 'a')!.within, 1, 'only t1 counts, as for the score');
  assert.equal(scores.find(s => s.genome === 'b')!.within, 0);
});

test('the cap counts money actually paid, not runs kept', async () => {
  answers(.1);
  const v = R.startVoyage('geotag', { raceTasks: 10, capGeneration: 1 });
  // money already paid in this generation by a run that was later discarded
  const L = await import('../src/ledger.ts');
  L.add({ voyage: v.id, generation: 0, kind: 'race', model: 'claude:claude-haiku-4-5', usd: 1.2, ms: 1 });
  const r = await R.race(v.id, 0, [g('good')], { baselines: false });
  assert.equal(r.complete, false);
  assert.equal(r.common.length, 0, 'nothing ran: the generation had already spent its cap');
});

test('a voyage cannot race the same generation twice at once', async () => {
  M.setDriver(async () => { await new Promise(r => setTimeout(r, 30)); return { text: '{"action":"answer","answer":{"lat":10,"lon":10}}', usd: .01, ms: 2 }; });
  const v = R.startVoyage('geotag', { raceTasks: 4, capGeneration: 100 });
  const first = R.race(v.id, 0, [g('good')], { baselines: false });
  await assert.rejects(R.race(v.id, 0, [g('good')], { baselines: false }), /already racing/);
  await first;
  // once the first has finished, racing again is allowed (and finds nothing left to do)
  const again = await R.race(v.id, 0, [g('good')], { baselines: false });
  assert.equal(again.complete, true);
});

test('a control keeps what the model replied, so a missing answer can be checked', async () => {
  const { baselines } = await import('../src/baselines.ts');
  M.setDriver(async () => ({ text: 'I cannot tell where this happened.', usd: 0, ms: 1 }));
  const b = baselines('geotag').find(x => x.name === 'one Claude call')!;
  const r = await b.answer({ id: 't', input: { text: 'x', hidden: 'A storm hits [place].', date: '2025-01-01' } });
  assert.equal(r.answer, null);
  assert.match(r.note, /I cannot tell/);
});
