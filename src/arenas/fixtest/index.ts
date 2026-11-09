// Fixing a failing test. A one-line bug is planted in beaglelib, a frozen snapshot of Beagle's own
// pure code with its own test suite. The agent sees which tests fail and how, may read and search
// the bugged copy and run the tests with proposed edits, and answers with find-and-replace edits.
// Grading applies them to a fresh clone and runs the whole suite: the tests are the ground truth.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync, cpSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Arena, Control, StarterGenome } from '../types.ts';
import { genericControls } from '../generic.ts';

export const LIB = resolve(import.meta.dirname, '..', '..', '..', 'fixtures', 'beaglelib');
export type Mutant = { file: string; line: number; original: string; mutated: string };
export type FixTruth = Mutant & { function: string; failing: string[] };
type Edit = { file: string; find: string; replace: string };

const files = (dir: string) => ['src', 'test'].flatMap(d => readdirSync(join(dir, d)).filter(f => f.endsWith('.ts')).map(f => `${d}/${f}`));

// a clone of the library with the bug in it: APFS clones each file (copy on write), so it is cheap
export function plant(m: Mutant): string {
  const dir = mkdtempSync(join(tmpdir(), 'beagle-fix-'));
  cpSync(LIB, dir, { recursive: true, mode: 1 /* COPYFILE_FICLONE: clone where the disk can */ });
  const p = join(dir, m.file), lines = readFileSync(p, 'utf8').split('\n');
  if (lines[m.line - 1] !== m.original) throw new Error(`the library has changed: ${m.file}:${m.line} is not the line this bug was made from`);
  lines[m.line - 1] = m.mutated; writeFileSync(p, lines.join('\n'));
  return dir;
}

// edits stay inside the library's source; each find must appear exactly once in its file
export function applyEdits(dir: string, edits: unknown): string | null {
  if (!Array.isArray(edits)) return 'edits must be a list';
  for (const e of edits as Edit[]) {
    if (!e || typeof e.file !== 'string' || typeof e.find !== 'string' || typeof e.replace !== 'string') return 'each edit needs a file, a find and a replace';
    const p = resolve(dir, e.file), rel = relative(dir, p);
    if (rel.startsWith('..') || !rel.startsWith(`src${sep}`)) return e.file.startsWith('test') ? 'the tests may not be changed' : `${e.file} is not a file of the library's source`;
    if (!existsSync(p)) return `there is no ${e.file}`;
    const text = readFileSync(p, 'utf8'), n = e.find ? text.split(e.find).length - 1 : 0;
    if (n !== 1) return `the find text appears ${n} times in ${e.file}; it must appear exactly once`;
    writeFileSync(p, text.replace(e.find, () => e.replace));
  }
  return null;
}

// the library's run is its own: not a child of any test runner Beagle itself runs under
const clean = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_OPTIONS; return e; };

// the library's own suite, in node's test runner; a run that goes on too long counts every test failed
export function runSuite(dir: string, ms = 30_000): Promise<{ failed: string[]; passed: number; total: number; output: string; timedOut: boolean }> {
  return new Promise(ok => {
    const p = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', '--test-reporter=tap', ...files(dir).filter(f => f.startsWith('test/'))], { cwd: dir, detached: true, env: clean() });
    let out = '', timedOut = false;
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* gone */ } }, ms);
    p.on('close', () => {
      clearTimeout(timer);
      const failed = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map(m => m[1].trim()).filter(n => !n.startsWith('test/'));
      const total = Number(/^# tests (\d+)/m.exec(out)?.[1] ?? 0), passed = Number(/^# pass (\d+)/m.exec(out)?.[1] ?? 0);
      ok({ failed: timedOut ? ['(the tests ran out of time)'] : failed, passed, total, output: out, timedOut });
    });
  });
}

// the first failure's report, as a person running the tests would read it
export function firstFailure(output: string) {
  const i = output.search(/^not ok /m); if (i < 0) return '';
  return output.slice(i).split(/\n(?=ok |not ok )/)[0].split('\n').filter(l => !/^\s+(duration_ms|type|location):/.test(l)).join('\n').slice(0, 1400);
}

export async function gradeFix(answer: unknown, truth: FixTruth): Promise<number> {
  const a = answer as { edits?: unknown } | null;
  if (!a || typeof a !== 'object') return 0;
  const dir = plant(truth);
  try {
    if (applyEdits(dir, a.edits ?? [])) return 0;
    const r = await runSuite(dir);
    if (r.timedOut) return 0;
    if (r.failed.some(n => !truth.failing.includes(n))) return 0;   // it broke something that worked
    return truth.failing.filter(n => !r.failed.includes(n)).length / truth.failing.length;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- the tools an agent may use, each on its own task's bugged copy ----
const planted = new Map<string, string>();
const copyFor = (ctx?: { task: { id: string; input: unknown } }) => {
  const m = (ctx?.task.input as { mutant?: Mutant })?.mutant; if (!m) throw new Error('no task');
  const key = createHash('sha1').update(JSON.stringify(m)).digest('hex');
  if (!planted.has(key) || !existsSync(planted.get(key)!)) planted.set(key, plant(m));
  return planted.get(key)!;
};
const inside = (dir: string, file: string) => { const p = resolve(dir, String(file ?? '')), rel = relative(dir, p); if (rel.startsWith('..') || !existsSync(p)) throw new Error(`there is no ${file}`); return p; };

const DESCRIBE = 'The test suite of beaglelib, a small TypeScript library, has started to fail: one line of the library\'s code has been broken. Find the bug and fix it with as small a change as you can. You may not change the tests. Answer with find-and-replace edits to the library\'s files under src/: each find must be text that appears exactly once in its file, and is replaced whole. Your fix scores by the share of the failing tests it mends, and 0 if any test that passed before now fails.';

export const fixtest: Arena = {
  id: 'fixtest', data: 'fixtest', name: 'Fix the failing test',
  describe: DESCRIBE,
  answer: { type: 'object', required: ['edits'], properties: { edits: { type: 'array', items: { type: 'object', required: ['file', 'find', 'replace'], properties: { file: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } } } } } },
  grade: (answer, truth) => gradeFix(answer, truth as FixTruth),
  graderTimeoutMs: 60_000, maxTurns: 14, kind: 'fixtest',
  brief: input => (input as { failing: string[] }).failing.join('; '),
  show: input => { const i = input as { failing: string[]; output: string }; return `These tests fail:\n${i.failing.map(n => `- ${n}`).join('\n')}\n\nThe first failure:\n${i.output}`; },
  valid: a => !!a && typeof a === 'object' && Array.isArray((a as { edits?: unknown }).edits),
  example: truth => { const t = truth as FixTruth; return JSON.stringify({ edits: [{ file: t.file, find: t.mutated.trim(), replace: t.original.trim() }] }); },
  miss: (answer, truth) => { const t = truth as FixTruth, e = ((answer as { edits?: Edit[] })?.edits ?? []); return `the bug was in ${t.file} line ${t.line}, in ${t.function}: "${t.mutated.trim()}" should be "${t.original.trim()}"; it edited ${e.length ? e.map(x => `${x.file} ("${String(x.find).slice(0, 60)}")`).join(', ') : 'nothing'}`; },
  tools: [
    { name: 'list_files', describe: 'List the library\'s files with their lengths in lines.', args: { type: 'object', properties: {} },
      run: (_a, ctx) => { const d = copyFor(ctx); return { files: files(d).map(f => ({ file: f, lines: readFileSync(join(d, f), 'utf8').split('\n').length })) }; } },
    { name: 'read_file', describe: 'Read a file of the library, with line numbers; give from and to to read part of it (at most 200 lines at once).', args: { type: 'object', required: ['file'], properties: { file: { type: 'string' }, from: { type: 'integer' }, to: { type: 'integer' } } },
      run: (a: { file: string; from?: number; to?: number }, ctx) => { const lines = readFileSync(inside(copyFor(ctx), a.file), 'utf8').split('\n'), from = Math.max(1, a.from ?? 1), to = Math.min(lines.length, a.to ?? from + 199, from + 199); return { file: a.file, lines: lines.slice(from - 1, to).map((l, i) => `${from + i}: ${l}`).join('\n') }; } },
    { name: 'search', describe: 'Search every file of the library for a regular expression; returns file:line: text for each match (at most 30).', args: { type: 'object', required: ['pattern'], properties: { pattern: { type: 'string' } } },
      run: (a: { pattern: string }, ctx) => { const d = copyFor(ctx); let re: RegExp; try { re = new RegExp(a.pattern); } catch { return { error: 'not a valid regular expression' }; } return { matches: files(d).flatMap(f => readFileSync(join(d, f), 'utf8').split('\n').map((l, i) => re.test(l) ? `${f}:${i + 1}: ${l.trim()}` : null).filter(Boolean)).slice(0, 30) }; } },
    { name: 'run_tests', describe: 'Run the whole test suite with your proposed edits applied to a fresh copy (the same edits you would answer with). Returns the tests that still fail and the first failure.', args: { type: 'object', properties: { edits: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } } } } } },
      run: async (a: { edits?: Edit[] }, ctx) => {
        const fresh = mkdtempSync(join(tmpdir(), 'beagle-try-'));
        try { cpSync(copyFor(ctx), fresh, { recursive: true, mode: 1 }); const bad = applyEdits(fresh, a?.edits ?? []); if (bad) return { error: bad };
          const r = await runSuite(fresh); return { failed: r.failed.slice(0, 10), passed: r.passed, total: r.total, first_failure: firstFailure(r.output) };
        } finally { rmSync(fresh, { recursive: true, force: true }); }
      } },
  ],
};

const READ = 'Read the failing tests\' names and output. Find the function they test, read it, and find the one line that is wrong. Fix that line with the smallest edit, then run the tests with your edit before you answer.';
const id = (s: string) => `fixtest-${s}`;
fixtest.starters = (): StarterGenome[] => [
  { id: id('haiku-reads'), name: 'Haiku, reads then fixes', model: 'claude:claude-haiku-4-5', instructions: READ, tools: ['list_files', 'read_file', 'search', 'run_tests'], workflow: { shape: 'single' }, memory: { examples: 0 } },
  { id: id('haiku-check'), name: 'Haiku, checks its fix', model: 'claude:claude-haiku-4-5', instructions: READ, tools: ['list_files', 'read_file', 'search', 'run_tests'], workflow: { shape: 'self-check' }, memory: { examples: 2 } },
  { id: id('haiku-blind'), name: 'Haiku, no tools', model: 'claude:claude-haiku-4-5', instructions: 'Work out from the failing tests which line of the library is wrong, and fix it.', tools: [], workflow: { shape: 'single' }, memory: { examples: 2 } },
  { id: id('sonnet-reads'), name: 'Sonnet, reads then fixes', model: 'claude:claude-sonnet-5', instructions: READ, tools: ['list_files', 'read_file', 'search', 'run_tests'], workflow: { shape: 'single' }, memory: { examples: 0 } },
  { id: id('sonnet-search'), name: 'Sonnet, searches only', model: 'claude:claude-sonnet-5', instructions: 'Search for the function the failing tests name, read only that, and fix the wrong line. Do not run the tests.', tools: ['search', 'read_file'], workflow: { shape: 'single' }, memory: { examples: 0 } },
  { id: id('qwen-coder'), name: 'Qwen coder 7B, reads then fixes', model: 'ollama:qwen2.5-coder:7b', instructions: READ, tools: ['list_files', 'read_file', 'search', 'run_tests'], workflow: { shape: 'single' }, memory: { examples: 2 } },
  { id: id('llama'), name: 'Llama 8B, reads then fixes', model: 'ollama:llama3.1:8b', instructions: READ, tools: ['list_files', 'read_file', 'search', 'run_tests'], workflow: { shape: 'single' }, memory: { examples: 2 } },
];
const noChange: Control = { name: 'no change', model: 'none', async answer() { return { answer: { edits: [] }, usd: 0, ms: 0, note: 'changes nothing: the floor' }; } };
fixtest.controls = () => [noChange, genericControls(fixtest)[1]];
