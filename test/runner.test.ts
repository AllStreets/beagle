import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setDriver, type Turn } from '../src/models/index.ts';
import { run } from '../src/runner.ts';
import type { Arena } from '../src/arenas/types.ts';
import { geotag } from '../src/arenas/geotag/index.ts';
import type { Genome } from '../src/genome.ts';

afterEach(() => setDriver(null));

const arena: Arena = {
  id: 'toy', data: 'toy', name: 'Toy', describe: 'Say where it happened.',
  answer: { type: 'object', required: ['lat', 'lon'], properties: { lat: { type: 'number' }, lon: { type: 'number' } } },
  grade: () => 1, show: i => String((i as { text: string }).text), valid: geotag.valid, merge: geotag.merge,   // answers are points, voted as geotagging votes
  tools: [{ name: 'lookup_place', describe: 'look up', args: { type: 'object' }, run: (a: { name: string }) => ({ matches: [{ name: a.name, lat: 49.49, lon: 8.47 }] }) }],
};
const genome = (o: Partial<Genome> = {}): Genome => ({ id: 'g', name: 'G', model: 'claude:claude-haiku-4-5', instructions: 'Be right.', tools: ['lookup_place'], workflow: { shape: 'single' }, memory: { examples: 0 }, ...o });
// a fake model that replies from a script, one reply per call, and records what it was sent
function scripted(replies: string[], usd = .01) {
  const seen: Turn[][] = [];
  setDriver(async (_p, _n, turns) => { seen.push(turns.map(t => ({ ...t }))); const text = replies.shift() ?? '{}'; return { text, usd, ms: 3 }; });
  return seen;
}
const task = { id: 't1', input: { text: 'A car drives into a crowd in Mannheim.' } };

test('a tool request is run and its result fed back before the answer', async () => {
  const seen = scripted(['{"action":"lookup_place","args":{"name":"Mannheim"}}', '{"action":"answer","answer":{"lat":49.49,"lon":8.47}}']);
  const r = await run(genome(), task, arena);
  assert.equal(r.status, 'done');
  assert.deepEqual(r.answer, { lat: 49.49, lon: 8.47 });
  assert.deepEqual(r.trace.map(s => s.kind), ['model', 'tool', 'model']);
  assert.match(seen[1].at(-1)!.content, /49\.49/, 'the second turn carries the tool result');
  assert.equal(Number(r.usd.toFixed(2)), 0.02, 'costs add up over model steps');
});

test('a model that keeps replying in the wrong shape gets no answer, not a crash', async () => {
  scripted(['I think it is Mannheim', '{"oops":true}', 'still prose']);
  const r = await run(genome(), task, arena);
  assert.equal(r.status, 'no-answer');
  assert.equal(r.answer, null);
  assert.match(JSON.stringify(r.trace.at(-1)), /no answer/i);
});

test('six turns of tools without an answer is no answer', async () => {
  scripted(Array(10).fill('{"action":"lookup_place","args":{"name":"Mannheim"}}'));
  const r = await run(genome(), task, arena);
  assert.equal(r.status, 'no-answer');
  assert.equal(r.trace.filter(s => s.kind === 'model').length, 6);
});

test('a tool the genome was not given is refused and the model told so', async () => {
  const seen = scripted(['{"action":"lookup_place","args":{"name":"Mannheim"}}', '{"action":"answer","answer":{"lat":1,"lon":2}}']);
  const r = await run(genome({ tools: [] }), task, arena);
  assert.equal(r.status, 'done');
  assert.ok(!r.trace.some(s => s.kind === 'tool'));
  assert.match(seen[1].at(-1)!.content, /not available/i);
});

test('a vote takes the answer in the middle of the others', async () => {
  scripted(['{"action":"answer","answer":{"lat":49.0,"lon":8.0}}', '{"action":"answer","answer":{"lat":49.4,"lon":8.4}}', '{"action":"answer","answer":{"lat":49.8,"lon":8.8}}']);
  const r = await run(genome({ tools: [], workflow: { shape: 'vote', n: 3 } }), task, arena);
  assert.deepEqual(r.answer, { lat: 49.4, lon: 8.4 }, 'of three answers in a line, the middle one');
  assert.equal(r.trace.filter(s => s.kind === 'model').length, 3);
  // an outlier never wins against two answers that agree
  scripted(['{"action":"answer","answer":{"lat":10,"lon":10}}', '{"action":"answer","answer":{"lat":49.4,"lon":8.4}}', '{"action":"answer","answer":{"lat":49.41,"lon":8.41}}']);
  const r2 = await run(genome({ tools: [], workflow: { shape: 'vote', n: 3 } }), task, arena);
  assert.notDeepEqual(r2.answer, { lat: 10, lon: 10 });
});

test('self-check asks the model to review its first answer', async () => {
  const seen = scripted(['{"action":"answer","answer":{"lat":1,"lon":1}}', '{"action":"answer","answer":{"lat":49.49,"lon":8.47}}']);
  const r = await run(genome({ tools: [], workflow: { shape: 'self-check' } }), task, arena);
  assert.deepEqual(r.answer, { lat: 49.49, lon: 8.47 });
  assert.match(seen[1].at(-1)!.content, /check/i);
});

test('plan-then-answer plans before it acts, and the plan is in the trace', async () => {
  scripted(['{"plan":"Find Mannheim, Germany."}', '{"action":"answer","answer":{"lat":49.49,"lon":8.47}}']);
  const r = await run(genome({ workflow: { shape: 'plan-then-answer' } }), task, arena);
  assert.equal(r.status, 'done');
  assert.match(JSON.stringify(r.trace[0].output), /Find Mannheim/);
});

test('worked examples are shown to the model', async () => {
  const seen = scripted(['{"action":"answer","answer":{"lat":1,"lon":1}}']);
  await run(genome({ memory: { examples: 1 } }), task, arena, { examples: [{ input: { text: 'Floods in Haifa.' }, truth: { places: [{ name: 'Haifa', lat: 32.8, lon: 35 }] } }] });
  assert.match(seen[0].map(t => t.content).join('\n'), /Floods in Haifa[\s\S]*32\.8/);
});

test('a tool is told which task it is working on', async () => {
  let seen: unknown = null;
  const a: Arena = { ...arena, tools: [{ name: 'lookup_place', describe: 'x', args: { type: 'object' }, run: (_a: unknown, ctx?: { task: { id: string } }) => { seen = ctx?.task.id; return {}; } }] };
  scripted(['{"action":"lookup_place","args":{"name":"x"}}', '{"action":"answer","answer":{"lat":1,"lon":1}}']);
  await run(genome(), task, a);
  assert.equal(seen, 't1');
});
