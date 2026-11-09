// Fixing a failing test: a one-line bug planted in beaglelib, fixed with find-and-replace edits,
// graded by the library's own test suite in a fresh clone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIB, runSuite, gradeFix, fixtest, plant, cleanTotal, type Mutant } from '../src/arenas/fixtest/index.ts';

const line = readFileSync(join(LIB, 'src/stats.ts'), 'utf8').split('\n').findIndex(l => l.startsWith('export const mean'));
const original = readFileSync(join(LIB, 'src/stats.ts'), 'utf8').split('\n')[line];
const bug: Mutant = { file: 'src/stats.ts', line: line + 1, original, mutated: original.replace(': 0;', ': 1;') };
const truth = { ...bug, function: 'mean', failing: ['mean of nothing is 0'] };
const fix = { edits: [{ file: 'src/stats.ts', find: 'xs.length : 1;', replace: 'xs.length : 0;' }] };
const ctx = { task: { id: 'fixtest:t', input: { mutant: bug, failing: truth.failing, output: '' } } };

test('the untouched library passes every one of its tests', async () => {
  const total = await cleanTotal();   // run in a clean copy, inside the same fence as any agent's code
  assert.ok(total >= 100, `${total} tests`);
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

test('review: an edit that stops a test file from running is not a fix', async () => {
  const syntax = { edits: [...fix.edits, { file: 'src/stats.ts', find: 'export function rng', replace: 'export function rng((' }] };
  assert.equal(await gradeFix(syntax, truth), 0, 'a syntax error empties the suite; that is not a mend');
  const quits = { edits: [...fix.edits, { file: 'src/stats.ts', find: 'export const mean', replace: 'process.exit(0);\nexport const mean' }] };
  assert.equal(await gradeFix(quits, truth), 0, 'quitting before the tests register is not a mend');
  const ran = await fixtest.tools.find(x => x.name === 'run_tests')!.run(syntax, ctx) as { failed: string[] };
  assert.ok(ran.failed.length > 0, 'run_tests says the suite is broken');
});

test('review: code an agent writes runs fenced in: no writing outside its copy, no network', async () => {
  const { tmpdir } = await import('node:os'); const { existsSync } = await import('node:fs');
  const out = join(tmpdir(), `beagle-escape-${Date.now()}`), home = join(process.env.HOME!, `.beagle-escape-${Date.now()}`);
  const escape = { edits: [...fix.edits, { file: 'src/stats.ts', find: 'export const mean', replace: `import { writeFileSync as __w } from 'node:fs'; try { __w(${JSON.stringify(out)}, 'x'); } catch {} try { __w(${JSON.stringify(home)}, 'x'); } catch {}\nexport const mean` }] };
  await gradeFix(escape, truth);
  assert.equal(existsSync(out), false, 'it could not write to the temp folder outside its copy');
  assert.equal(existsSync(home), false, 'it could not write to the home folder');
});

test('review: a bug that no longer fits the library leaves no clone behind', async () => {
  const { readdirSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  const count = () => readdirSync(tmpdir()).filter(f => f.startsWith('beagle-fix-')).length, before = count();
  assert.throws(() => plant({ ...bug, original: 'not the line' }), /library has changed/);
  assert.equal(count(), before);
});
