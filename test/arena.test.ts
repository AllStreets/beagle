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

test('the API lists any arena\'s items by their brief, says what kind of arena it is, and re-grades it on the server', async () => {
  const { serve } = await import('../src/server.ts');
  const server = serve(0); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    M.setDriver(async () => ({ text: say('large'), usd: 0, ms: 1 }));
    const v = R.startVoyage('words', { raceTasks: 6, capGeneration: 100 });
    await R.race(v.id, 0, [g('a')], { baselines: false });
    const tasks = await (await fetch(`${base}/api/voyages/${v.id}/generations/0/tasks`)).json();
    assert.equal(tasks.length, 6); assert.match(tasks[0].shown, /^big \d$/);
    const arena = await (await fetch(`${base}/api/arenas/words/sample`)).json();
    assert.equal(arena.kind, 'custom'); assert.equal(arena.inBrowser, false);
    const fv = R.startVoyage('fixtest', { raceTasks: 1 });
    const typed = await fetch(`${base}/api/try`, { method: 'POST', headers: { 'x-beagle': '1', 'content-type': 'application/json' }, body: JSON.stringify({ voyage: fv.id, genome: 'baseline:no change', text: 'fix it' }) });
    assert.equal(typed.status, 400, 'an arena that takes no typed items says so');
    const rg = await (await fetch(`${base}/api/voyages/${v.id}/regrade`, { method: 'POST', headers: { 'x-beagle': '1' } })).json();
    assert.deepEqual(rg.generations.map((x: any) => [x.generation, x.runs, x.agree]), [[0, 6, 6]]);
    assert.equal(rg.generations[0].best.recorded.mean, rg.generations[0].best.again.mean);
  } finally { server.close(); }
});

test('local agents: Claude agents sit out the race, and the designer may breed only local ones', async () => {
  const D = await import('../src/designer.ts');
  const prompts: string[] = [];
  M.setDriver(async (_p, name, turns) => {
    if (name.includes('opus')) { prompts.push(turns.map(t => t.content).join('\n')); return { text: JSON.stringify({ children: [
      { name: 'local child', parents: ['l'], model: 'ollama:llama3.1:8b', instructions: 'x', tools: [], workflow: { shape: 'single' }, memory: { examples: 0 }, reason: 'r' },
      { name: 'claude child', parents: ['l'], model: 'claude:claude-sonnet-5', instructions: 'x', tools: [], workflow: { shape: 'single' }, memory: { examples: 0 }, reason: 'r' } ] }), usd: 0, ms: 1 }; }
    return { text: say('large'), usd: 0, ms: 1 };
  });
  const v = R.startVoyage('words', { raceTasks: 6, capGeneration: 100, localAgents: true });
  const r = await R.race(v.id, 0, [g('l', { model: 'ollama:llama3.1:8b' }), g('c')], { baselines: false });
  assert.deepEqual(r.scores.map(s => s.genome), ['l'], 'the Claude agent did not race');
  const bred = await D.breed(v.id, 0, { children: 2, elites: 1, probe: 1 });
  assert.match(prompts[0], /Allowed models: ollama:/); assert.doesNotMatch(prompts[0].split('Allowed models:')[1].split('\n')[0], /claude:/);
  assert.deepEqual(bred.next.map(x => x.name), ['l', 'local child']);
  assert.match(bred.refused[0].why, /this Mac/);
});

test('the designer may give a child any tool of its own arena, and only those', async () => {
  const D = await import('../src/designer.ts');
  A.registerArena({ ...words, id: 'words-calc', data: 'words', tools: [{ name: 'calculate', describe: 'x', args: {}, run: () => ({}) }] } as any);
  M.setDriver(async (_p, name) => name.includes('opus') ? { text: JSON.stringify({ children: [
    { name: 'with calc', parents: ['a'], model: 'ollama:llama3.1:8b', instructions: 'x', tools: ['calculate'], workflow: { shape: 'single' }, memory: { examples: 0 }, reason: 'r' },
    { name: 'with lookup', parents: ['a'], model: 'ollama:llama3.1:8b', instructions: 'x', tools: ['lookup_place'], workflow: { shape: 'single' }, memory: { examples: 0 }, reason: 'r' } ] }), usd: 0, ms: 1 } : { text: say('large'), usd: 0, ms: 1 });
  const v = R.startVoyage('words-calc', { raceTasks: 6, capGeneration: 100 });
  await R.race(v.id, 0, [g('a')], { baselines: false });
  const bred = await D.breed(v.id, 0, { children: 2, elites: 1, probe: 1 });
  assert.deepEqual(bred.next.map(x => x.name), ['a', 'with calc']);
  assert.match(bred.refused[0].why, /lookup_place/);
});
