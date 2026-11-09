// Any arena, not only geotagging: a toy arena whose answers are words runs through the runner,
// votes, races, re-grading and the designer with none of the geotag code.
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-arena-'));
process.env.BEAGLE_BACKOFF_MS = '5';
let M: typeof import('../src/models/index.ts'), R: typeof import('../src/race.ts'), run: typeof import('../src/runner.ts').run, A: typeof import('../src/arenas/index.ts'), store: typeof import('../src/store.ts');

// answers are { word }, graded asynchronously; a word of "boom" makes the grader throw
const words = {
  id: 'words', data: 'words', name: 'Say the word', describe: 'Say the word that means the same as the one given.',
  answer: { type: 'object', required: ['word'], properties: { word: { type: 'string' } } },
  grade: async (a: any, t: any) => { if (a.word === 'boom') throw new Error('grader broke'); return a.word === t.word ? 1 : 0; },
  valid: (a: any) => typeof a?.word === 'string' && a.word.length > 0,
  example: (t: any) => JSON.stringify({ word: t.word }),
  miss: (a: any, t: any) => `said "${a?.word}", the word was "${t.word}"`,
  show: (i: any) => i.text, tools: [],
};
const g = (id: string, o: object = {}) => ({ id, name: id, model: 'claude:claude-haiku-4-5', instructions: 'Answer.', tools: [], workflow: { shape: 'single' as const }, memory: { examples: 0 }, ...o });
const say = (w: string) => `{"action":"answer","answer":{"word":"${w}"}}`;

before(async () => {
  M = await import('../src/models/index.ts'); R = await import('../src/race.ts'); run = (await import('../src/runner.ts')).run; A = await import('../src/arenas/index.ts'); store = await import('../src/store.ts');
  A.registerArena(words as any);
  const put = store.open().prepare('insert into tasks (id, arena, split, input, truth, meta) values (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 6; i++) put.run(`w-r${i}`, 'words', 'race', JSON.stringify({ text: `big ${i}` }), JSON.stringify({ word: 'large' }), '{}');
  for (let i = 0; i < 6; i++) put.run(`w-b${i}`, 'words', 'breeding', JSON.stringify({ text: `small ${i}` }), JSON.stringify({ word: 'little' }), '{}');
  put.run('w-s0', 'words', 'sealed', JSON.stringify({ text: 'SECRET' }), JSON.stringify({ word: 'x' }), '{}');
});
afterEach(() => M.setDriver(null));

test('an answer is accepted by the arena\'s own check, not by the shape of a point', async () => {
  M.setDriver(async () => ({ text: say('large'), usd: 0, ms: 1 }));
  const r = await run(g('a'), { id: 't', input: { text: 'big' } }, A.getArena('words'));
  assert.equal(r.status, 'done'); assert.deepEqual(r.answer, { word: 'large' });
  M.setDriver(async () => ({ text: '{"action":"answer","answer":{"word":""}}', usd: 0, ms: 1 }));
  assert.equal((await run(g('a'), { id: 't', input: { text: 'big' } }, A.getArena('words'))).status, 'no-answer');
});

test('a vote of words keeps the answer most agents gave', async () => {
  const replies = [say('large'), say('huge'), say('large')];
  M.setDriver(async () => ({ text: replies.shift()!, usd: 0, ms: 1 }));
  const r = await run(g('v', { workflow: { shape: 'vote', n: 3 } }), { id: 't', input: { text: 'big' } }, A.getArena('words'));
  assert.deepEqual(r.answer, { word: 'large' });
});

test('worked examples are written by the arena', async () => {
  const seen: string[] = [];
  M.setDriver(async (_p, _n, turns) => { seen.push(turns[0].content); return { text: say('large'), usd: 0, ms: 1 }; });
  await run(g('e', { memory: { examples: 1 } }), { id: 't', input: { text: 'big' } }, A.getArena('words'), { examples: [{ input: { text: 'small' }, truth: { word: 'little' } }] });
  assert.match(seen[0], /Answer: \{"word":"little"\}/);
});

test('a race grades with an async grader, and a grader that throws scores the run 0 instead of stopping the race', async () => {
  M.setDriver(async (_p, _n, turns) => ({ text: /big 0/.test(turns.at(-1)!.content) ? say('boom') : say('large'), usd: 0, ms: 1 }));
  const v = R.startVoyage('words', { raceTasks: 6, capGeneration: 100 });
  const r = await R.race(v.id, 0, [g('a')], { baselines: false });
  assert.equal(r.complete, true);
  assert.ok(Math.abs(r.scores[0].mean - 5 / 6) < 1e-9, `${r.scores[0].mean}`);
});

test('re-grading a bundle of any arena reproduces its scores', async () => {
  M.setDriver(async () => ({ text: say('large'), usd: 0, ms: 1 }));
  const v = R.startVoyage('words', { raceTasks: 6, capGeneration: 100 });
  await R.race(v.id, 0, [g('a')], { baselines: false });
  const { exportBundle, regrade } = await import('../src/bundle.ts');
  const r = await regrade(exportBundle(v.id));
  assert.equal(r.mismatches, 0); assert.equal(r.scores[0].mean, 1);
});

test('the designer reads misses in the arena\'s own words', async () => {
  const D = await import('../src/designer.ts');
  const prompts: string[] = [];
  M.setDriver(async (_p, name, turns) => {
    if (name.includes('opus')) { prompts.push(turns.map(t => t.content).join('\n')); return { text: JSON.stringify({ children: [] }), usd: 0, ms: 1 }; }
    return { text: say('wrong'), usd: 0, ms: 1 };
  });
  const v = R.startVoyage('words', { raceTasks: 6, capGeneration: 100 });
  await R.race(v.id, 0, [g('a')], { baselines: false });
  await D.breed(v.id, 0, { children: 1, elites: 1, probe: 2 });
  assert.match(prompts[0], /said "wrong", the word was "little"/);
  assert.doesNotMatch(prompts[0], /SECRET|big \d/, 'no race or sealed item reaches the designer');
  assert.doesNotMatch(prompts[0], /lookup_place/, 'the designer is offered only this arena\'s tools');
});
