// Fixing a failing test: a one-line bug planted in beaglelib, fixed with find-and-replace edits,
// graded by the library's own test suite in a fresh clone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, runSuite, gradeFix, fixtest, plant, type Mutant } from '../src/arenas/fixtest/index.ts';

const line = readFileSync(join(LIB, 'src/stats.ts'), 'utf8').split('\n').findIndex(l => l.startsWith('export const mean'));
const original = readFileSync(join(LIB, 'src/stats.ts'), 'utf8').split('\n')[line];
const bug: Mutant = { file: 'src/stats.ts', line: line + 1, original, mutated: original.replace(': 0;', ': 1;') };
const truth = { ...bug, function: 'mean', failing: ['mean of nothing is 0'] };
const fix = { edits: [{ file: 'src/stats.ts', find: 'xs.length : 1;', replace: 'xs.length : 0;' }] };
const ctx = { task: { id: 'fixtest:t', input: { mutant: bug, failing: truth.failing, output: '' } } };

test('the untouched library passes every one of its tests', async () => {
  const r = await runSuite(LIB);
  assert.equal(r.failed.length, 0); assert.ok(r.total >= 100, `${r.total} tests`);
});

test('a planted bug fails exactly the tests it should', async () => {
  const dir = plant(bug);
  const r = await runSuite(dir);
  assert.deepEqual(r.failed, ['mean of nothing is 0']);
  assert.ok(!readFileSync(join(LIB, 'src/stats.ts'), 'utf8').includes(bug.mutated), 'the library itself is never changed');
});

test('the right fix scores 1, and no fix scores 0', async () => {
  assert.equal(await gradeFix(fix, truth), 1);
  assert.equal(await gradeFix({ edits: [] }, truth), 0);
});

test('touching a test file, leaving the library, or an ambiguous find scores 0', async () => {
  assert.equal(await gradeFix({ edits: [...fix.edits, { file: 'test/stats.test.ts', find: 'mean of nothing is 0', replace: 'gone' }] }, truth), 0);
  assert.equal(await gradeFix({ edits: [{ file: '../../src/stats.ts', find: 'x', replace: 'y' }] }, truth), 0);
  assert.equal(await gradeFix({ edits: [{ file: 'src/stats.ts', find: 'xs', replace: 'ys' }] }, truth), 0, 'a find that matches many places is refused');
  assert.equal(await gradeFix(null, truth), 0);
});

test('a fix that mends the bug but breaks another test scores 0', async () => {
  const breaks = { edits: [...fix.edits, { file: 'src/text.ts', find: "x < 1 ? 3 : 2", replace: 'x < 1 ? 4 : 2' }] };
  assert.equal(await gradeFix(breaks, truth), 0);
});

test('the tools read the planted copy and run the tests with proposed edits', async () => {
  const t = (n: string) => fixtest.tools.find(x => x.name === n)!;
  const files = await t('list_files').run({}, ctx) as { files: { file: string }[] };
  assert.ok(files.files.some(f => f.file === 'src/stats.ts') && files.files.some(f => f.file === 'test/stats.test.ts'));
  const read = await t('read_file').run({ file: 'src/stats.ts', from: line + 1, to: line + 1 }, ctx) as { lines: string };
  assert.match(read.lines, /: 1;/, 'the agent reads the bugged line');
  const found = await t('search').run({ pattern: 'export const mean' }, ctx) as { matches: string[] };
  assert.equal(found.matches.length, 1);
  const before = await t('run_tests').run({ edits: [] }, ctx) as { failed: string[] };
  assert.deepEqual(before.failed, ['mean of nothing is 0']);
  const failing = await t('run_tests').run({ edits: [] }, ctx) as { first_failure: string };
  assert.doesNotMatch(failing.first_failure, /beagle-(try|fix)-|\/var\/folders|\/tmp\//, 'the agent is not shown where the copy lives on this Mac');
  assert.match(failing.first_failure, /beaglelib\/test\/stats\.test\.ts/);
  const after = await t('run_tests').run(fix, ctx) as { failed: string[]; passed: number };
  assert.deepEqual(after.failed, []);
  const refused = await t('run_tests').run({ edits: [{ file: 'test/stats.test.ts', find: 'a', replace: 'b' }] }, ctx) as { error?: string };
  assert.match(refused.error ?? '', /tests/);
});

test('a bug that loops forever is stopped, and every test counts as failed', async () => {
  const loopLine = readFileSync(join(LIB, 'src/stats.ts'), 'utf8').split('\n').findIndex(l => l.includes('left = left.filter'));
  const o = readFileSync(join(LIB, 'src/stats.ts'), 'utf8').split('\n')[loopLine];
  const r = await runSuite(plant({ file: 'src/stats.ts', line: loopLine + 1, original: o, mutated: o.replace('left = left.filter(i => !front.includes(i)); r++;', 'r++;') }), 4000);
  assert.equal(r.timedOut, true);
});
