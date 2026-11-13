import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Beagle as a library: what another program (Palimpsest) needs to import it, write its own tasks
// into Beagle's store, drive every model call, stop a race, and score on the sealed split.
process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-library-'));
process.env.BEAGLE_BACKOFF_MS = '5';

let M: typeof import('../src/models/index.ts'), R: typeof import('../src/race.ts'), D: typeof import('../src/designer.ts');
let G: typeof import('../src/genome.ts'), A: typeof import('../src/arenas/index.ts'), store: typeof import('../src/store.ts');
const g = (id: string, model = 'claude:claude-haiku-4-5', shape: 'single' | 'self-check' = 'single') => ({ id, name: id, model, instructions: 'Answer.', tools: [], workflow: { shape }, memory: { examples: 0 } });

// A small arena of its own, as Palimpsest registers one: its data is its id, its answer a word.
const word = { type: 'object', required: ['word'], properties: { word: { type: 'string' } } };
const lib = { id: 'lib', data: 'lib', name: 'Name the word', describe: 'Say the word in the item.', answer: word, tools: [],
  grade: (a: unknown, t: unknown) => (a as { word?: string })?.word === (t as { word: string }).word ? 1 : 0,
  show: (i: unknown) => `ITEM ${(i as { word: string }).word}` };
const rows = (split: 'breeding' | 'race' | 'sealed', n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, input: { word: `${prefix}${i}` }, truth: { word: `${prefix}${i}` }, split }));

// "good" says the word in the item; "bad" says something else; a call costs nothing
const sayWord = () => M.setDriver(async (_p, name, turns) => {
  const item = /ITEM (\S+)/.exec(turns.at(-1)!.content)?.[1] ?? /ITEM (\S+)/.exec(turns.map(t => t.content).join('\n'))?.[1] ?? '';
  return { text: JSON.stringify({ action: 'answer', answer: { word: name === 'bad' ? 'nope' : item } }), usd: 0, ms: 1 };
});

before(async () => {
  M = await import('../src/models/index.ts'); R = await import('../src/race.ts'); D = await import('../src/designer.ts');
  G = await import('../src/genome.ts'); A = await import('../src/arenas/index.ts'); store = await import('../src/store.ts');
  A.registerArena(lib);
  store.putArena('lib', 'Name the word');
  store.putTasks('lib', [...rows('breeding', 4, 'b'), ...rows('race', 4, 'r'), ...rows('sealed', 3, 's')]);
});
afterEach(() => M.setDriver(null));

test('the package names its entry points, so another program can import Beagle by name', async () => {
  const race = await import('beagle/race'), designer = await import('beagle/designer'), genome = await import('beagle/genome');
  const stats = await import('beagle/stats'), runner = await import('beagle/runner'), arenas = await import('beagle/arenas');
  const models = await import('beagle/models'), st = await import('beagle/store');
  assert.equal(typeof race.race, 'function'); assert.equal(typeof race.sealedRace, 'function'); assert.equal(typeof race.compareToParents, 'function');
  assert.equal(typeof designer.breed, 'function'); assert.equal(typeof genome.validate, 'function'); assert.equal(typeof stats.bootstrap, 'function');
  assert.equal(typeof runner.run, 'function'); assert.equal(typeof arenas.splitOf, 'function'); assert.equal(typeof models.setDriver, 'function');
  assert.equal(typeof st.putTasks, 'function');
});

test('a genome on mlx:grad-1 validates', () => {
  assert.equal(G.validate(g('m', 'mlx:grad-1'), []).model, 'mlx:grad-1');
  assert.throws(() => G.validate(g('x', 'gpt:5'), []), /model must be/);
});

test('complete passes mlx to the driver', async () => {
  const seen: string[] = [];
  M.setDriver(async (provider, name) => { seen.push(`${provider}/${name}`); return { text: 'ok', usd: 3, ms: 1 }; });
  const r = await M.complete('mlx:grad-1', [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(seen, ['mlx/grad-1']);
  assert.equal(r.usd, 0, 'a model on this Mac is free');
  // Beagle has no mlx server of its own: without a driver it says so
  M.setDriver(null);
  await assert.rejects(M.complete('mlx:grad-1', [{ role: 'user', content: 'hi' }]), /mlx/);
});

test('the self-check turn of a fix-test genome does not mention where anything happened', async () => {
  const { run } = await import('../src/runner.ts');
  const said: string[] = [];
  M.setDriver(async (_p, _n, turns) => { said.push(turns.at(-1)!.content); return { text: '{"action":"answer","answer":{"edits":[]}}', usd: 0, ms: 1 }; });
  await run(g('f', 'ollama:qwen3:1.7b', 'self-check'), { id: 't', input: { failing: ['adds'], output: 'expected 2' } }, A.getArena('fixtest'));
  const check = said.find(s => s.startsWith('You answered'));
  assert.ok(check, 'a self-check turn was asked');
  assert.doesNotMatch(check!, /where this happened|place/i);
  // geotagging keeps its own wording
  said.length = 0;
  M.setDriver(async (_p, _n, turns) => { said.push(turns.at(-1)!.content); return { text: '{"action":"answer","answer":{"lat":1,"lon":2}}', usd: 0, ms: 1 }; });
  await run(g('geo', 'ollama:qwen3:1.7b', 'self-check'), { id: 't', input: { text: 'x', date: '2024-01-01' } }, A.getArena('geotag'));
  assert.match(said.find(s => s.startsWith('You answered'))!, /where this happened/);
});

test('breed uses the designer it is given', async () => {
  const designers: string[] = [];
  M.setDriver(async (p, name, turns) => {
    if (turns.some(t => t.content.includes('design the next generation'))) {
      designers.push(`${p}:${name}`);
      return { text: JSON.stringify({ children: [{ name: 'Says it plainly', parents: ['good'], model: 'mlx:grad-1', instructions: 'Say the word.', tools: [], workflow: { shape: 'single' }, memory: { examples: 0 }, reason: 'it already wins' }] }), usd: 0, ms: 1 };
    }
    const item = /ITEM (\S+)/.exec(turns.at(-1)!.content)?.[1] ?? '';
    return { text: JSON.stringify({ action: 'answer', answer: { word: item } }), usd: 0, ms: 1 };
  });
  // agents on this Mac only, and a local designer: nothing reaches Claude, so breeding is allowed
  const v = R.startVoyage('lib', { raceTasks: 4, localOnly: true, localAgents: true });
  await R.race(v.id, 0, [g('good', 'ollama:qwen3:1.7b')], { baselines: false });
  const out = await D.breed(v.id, 0, { children: 1, elites: 1, probe: 1, designer: 'ollama:qwen3:30b' });
  assert.deepEqual(designers, ['ollama:qwen3:30b']);
  assert.deepEqual(out.next.map(x => x.model), ['ollama:qwen3:1.7b', 'mlx:grad-1'], 'an mlx child runs on this Mac too');
  const used = store.open().prepare(`select model from ledger where voyage = ? and kind = 'design' and model = ?`).all(v.id, 'ollama:qwen3:30b');
  assert.equal(used.length, 1);
  // a Claude designer on a voyage that never calls Claude is still refused
  await assert.rejects(D.breed(v.id, 0, { children: 1, elites: 1, probe: 1, designer: 'claude:claude-sonnet-5' }), /Claude/);
});

test('an aborted race scores no unfinished run and says aborted', async () => {
  const stop = new AbortController();
  let calls = 0;
  M.setDriver(async (_p, _n, turns, o) => {
    calls++;
    if (calls === 2) {
      // stopped while this call is in flight: the answer that comes back is never scored
      stop.abort();
      if (o.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    }
    const item = /ITEM (\S+)/.exec(turns.at(-1)!.content)?.[1] ?? '';
    return { text: JSON.stringify({ action: 'answer', answer: { word: item } }), usd: 0, ms: 1 };
  });
  const v = R.startVoyage('lib', { raceTasks: 4, concurrency: 1 });
  const r = await R.race(v.id, 0, [g('a', 'ollama:qwen3:1.7b')], { baselines: false, signal: stop.signal });
  assert.equal(r.complete, false);
  assert.equal(r.reason, 'aborted');
  const stored = store.open().prepare('select task, score from runs where voyage = ?').all(v.id) as { task: string; score: number }[];
  assert.equal(stored.length, 1, 'only the run that finished before the abort is stored');
  assert.equal(stored[0].score, 1);
  // the next race picks up where it stopped
  const again = await R.race(v.id, 0, [g('a', 'ollama:qwen3:1.7b')], { baselines: false });
  assert.equal(again.complete, true);
  assert.equal((store.open().prepare('select count(*) as n from runs where voyage = ?').get(v.id) as { n: number }).n, 4);
});

test('compareToParents gives lo above zero for a child better on every common task and spans zero for a tie', async () => {
  sayWord();
  const v = R.startVoyage('lib', { raceTasks: 4 });
  await R.race(v.id, 0, [g('parent', 'claude:bad')], { baselines: false });
  // the designer's children, with their parents, as breed() stores them
  const put = store.open().prepare('insert into genomes (id, voyage, generation, parent_ids, body, reason) values (?, ?, ?, ?, ?, ?)');
  const better = g('better', 'claude:good'), tie = g('tie', 'claude:bad');
  put.run('better', v.id, 1, '["parent"]', JSON.stringify(better), 'says the word');
  put.run('tie', v.id, 1, '["parent"]', JSON.stringify(tie), 'no change');
  await R.race(v.id, 1, [better, tie], { baselines: false });
  const cmp = R.compareToParents(v.id, 1);
  const of = (child: string) => cmp.find(c => c.child === child)!;
  assert.equal(of('better').parent, 'parent');
  assert.equal(of('better').diff, 1);
  assert.ok(of('better').lo > 0, `lo ${of('better').lo}`);
  assert.equal(of('better').tasks, 4);
  assert.ok(of('tie').lo <= 0 && of('tie').hi >= 0, 'a tie spans zero');
  // a kept parent is not compared with itself
  assert.equal(cmp.some(c => c.child === c.parent), false);
});

test('paths follow BEAGLE_HOME changed between calls', async () => {
  const { paths } = await import('../src/paths.ts');
  const first = process.env.BEAGLE_HOME!, other = mkdtempSync(join(tmpdir(), 'beagle-library-other-'));
  const before = store.open();
  try {
    process.env.BEAGLE_HOME = other;
    assert.equal(paths.home, other);
    assert.equal(paths.db, join(other, 'beagle.db'));
    const there = store.open();
    assert.notEqual(there, before, 'the store reopens at the new home');
    assert.ok(existsSync(join(other, 'beagle.db')));
    assert.equal((there.prepare(`select count(*) as n from tasks where arena = 'lib'`).get() as { n: number }).n, 0);
  } finally {
    process.env.BEAGLE_HOME = first;
  }
  assert.equal(paths.home, first);
  assert.equal((store.open().prepare(`select count(*) as n from tasks where arena = 'lib'`).get() as { n: number }).n, 11);
});

test('splitOf is importable from ./arenas', async () => {
  const custom = await import('../src/arenas/custom.ts');
  assert.equal(A.splitOf, custom.splitOf);
  assert.ok(['breeding', 'race', 'sealed'].includes(A.splitOf('lib:anything')));
});

test('putTasks writes tasks a race then reads, and sealedHash changes when a sealed task changes', async () => {
  const arena = store.open().prepare(`select id, name from arenas where id = 'lib'`).get() as { id: string; name: string };
  assert.deepEqual({ ...arena }, { id: 'lib', name: 'Name the word' });
  const seen: string[] = [];
  M.setDriver(async (_p, _n, turns) => { const item = /ITEM (\S+)/.exec(turns.at(-1)!.content)?.[1] ?? ''; seen.push(item); return { text: JSON.stringify({ action: 'answer', answer: { word: item } }), usd: 0, ms: 1 }; });
  const v = R.startVoyage('lib', { raceTasks: 10 });
  const r = await R.race(v.id, 0, [g('a', 'ollama:qwen3:1.7b')], { baselines: false });
  assert.deepEqual(r.common, ['r0', 'r1', 'r2', 'r3'], 'the race reads the tasks written into the store, the race split only');
  assert.deepEqual([...seen].sort(), ['r0', 'r1', 'r2', 'r3']);
  const hash = R.sealedHash('lib');
  // a task is replaced by its id
  store.putTasks('lib', [{ id: 's1', input: { word: 's1' }, truth: { word: 'changed' }, split: 'sealed' }]);
  assert.equal((store.open().prepare(`select count(*) as n from tasks where arena = 'lib'`).get() as { n: number }).n, 11);
  assert.notEqual(R.sealedHash('lib'), hash);
  store.putTasks('lib', [{ id: 's1', input: { word: 's1' }, truth: { word: 's1' }, split: 'sealed' }]);
  assert.equal(R.sealedHash('lib'), hash);
});

test('sealedRace scores two genomes on the sealed split outside any voyage, and a second call scores afresh', async () => {
  let calls = 0;
  M.setDriver(async (_p, name, turns) => { calls++; const item = /ITEM (\S+)/.exec(turns.at(-1)!.content)?.[1] ?? ''; return { text: JSON.stringify({ action: 'answer', answer: { word: name === 'bad' ? 'nope' : item } }), usd: 0, ms: 1 }; });
  const voyagesBefore = (store.open().prepare(`select count(*) as n from voyages where status != 'sealed'`).get() as { n: number }).n;
  const first = await R.sealedRace('lib', [g('good', 'ollama:good'), g('bad', 'ollama:bad')], { seed: 1 });
  assert.equal(first.hash, R.sealedHash('lib'));
  assert.deepEqual(first.scores.map(s => [s.genome, s.mean, s.tasks]), [['good', 1, 3], ['bad', 0, 3]]);
  assert.deepEqual(first.perTask.good, { s0: 1, s1: 1, s2: 1 });
  assert.deepEqual(first.perTask.bad, { s0: 0, s1: 0, s2: 0 });
  assert.equal(calls, 6, 'only the sealed split, every genome once per task');
  const second = await R.sealedRace('lib', [g('good', 'ollama:good'), g('bad', 'ollama:bad')], { seed: 1 });
  assert.equal(calls, 12, 'a second call races again, not from stored runs');
  assert.deepEqual(second.perTask, first.perTask);
  // no voyage a person sees was started
  assert.equal((store.open().prepare(`select count(*) as n from voyages where status != 'sealed'`).get() as { n: number }).n, voyagesBefore);
  // an aborted sealed race says so
  const stop = new AbortController(); stop.abort();
  const aborted = await R.sealedRace('lib', [g('good', 'ollama:good')], { signal: stop.signal });
  assert.equal(aborted.complete, false);
});

test('putTasks refuses a task id another arena already holds', () => {
  const before = store.open().prepare(`select arena, truth from tasks where id = 'r0'`).get() as { arena: string; truth: string };
  assert.throws(() => store.putTasks('other', [{ id: 'r0', input: { word: 'x' }, truth: { word: 'x' }, split: 'race' }]), /r0.*lib/);
  const after = store.open().prepare(`select arena, truth from tasks where id = 'r0'`).get() as { arena: string; truth: string };
  assert.deepEqual({ ...after }, { ...before }, 'the other arena\'s task is left as it was');
  // nothing of a refused batch is written
  assert.throws(() => store.putTasks('other', [{ id: 'other:1', input: {}, truth: {}, split: 'race' }, { id: 'r1', input: {}, truth: {}, split: 'race' }]));
  assert.equal(store.open().prepare(`select 1 from tasks where id = 'other:1'`).get(), undefined);
});

test('the designer is never offered Claude models on a voyage that uses only this Mac', async () => {
  const systems: string[] = [];
  M.setDriver(async (_p, _name, turns) => {
    if (turns.some(t => t.content.includes('design the next generation'))) {
      systems.push(turns[0].content);
      return { text: JSON.stringify({ children: [] }), usd: 0, ms: 1 };
    }
    const item = /ITEM (\S+)/.exec(turns.at(-1)!.content)?.[1] ?? '';
    return { text: JSON.stringify({ action: 'answer', answer: { word: item } }), usd: 0, ms: 1 };
  });
  const v = R.startVoyage('lib', { raceTasks: 4, localOnly: true, localAgents: false });
  await R.race(v.id, 0, [g('good', 'ollama:qwen3:1.7b')], { baselines: false });
  await D.breed(v.id, 0, { children: 1, elites: 1, probe: 1, designer: 'ollama:qwen3:30b' });
  assert.equal(systems.length, 1);
  assert.doesNotMatch(systems[0], /claude:/);
  assert.match(systems[0], /only these local models/);
});

test('a Claude call stopped before it starts never runs Claude Code', async () => {
  const { claude } = await import('../src/models/claude.ts');
  // a stand-in claude on PATH that would answer if it were ever started
  const bin = mkdtempSync(join(tmpdir(), 'beagle-fake-claude-')), marker = join(bin, 'started');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`); chmodSync(join(bin, 'claude'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const stop = new AbortController(); stop.abort();
    await assert.rejects(claude('claude-haiku-4-5', [{ role: 'user', content: 'hi' }], { signal: stop.signal }), (e: unknown) => (e as Error).name === 'AbortError');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(existsSync(marker), false, 'Claude Code was never started');
  } finally { process.env.PATH = path; }
});
