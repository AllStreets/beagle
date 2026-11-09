// Builds the fix-test arena: every one-line mutation of beaglelib's source that a few of its tests
// catch. Each mutant is run against the whole suite; one that fails between 1 and 8 tests, and
// does not hang, becomes a task. Tasks are split by the function they break, so no function is
// in both the items to learn from and the items raced on.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../src/store.ts';
import { LIB, plant, runSuite, firstFailure, type Mutant } from '../src/arenas/fixtest/index.ts';

const OPS: [RegExp, string][] = [
  [/ <= /g, ' < '], [/ < /g, ' <= '], [/ >= /g, ' > '], [/ > /g, ' >= '], [/ === /g, ' !== '], [/ !== /g, ' === '],
  [/ && /g, ' || '], [/ \|\| /g, ' && '], [/ \+ 1\b/g, ' - 1'], [/ - 1\b/g, ' + 1'], [/ \* /g, ' / '],
  [/Math\.min/g, 'Math.max'], [/Math\.max/g, 'Math.min'], [/Math\.floor/g, 'Math.ceil'], [/Math\.ceil/g, 'Math.floor'],
  [/\breturn 0\b/g, 'return 1'], [/\breturn 1\b/g, 'return 0'], [/\btrue\b/g, 'false'], [/\bfalse\b/g, 'true'],
  [/\.slice\(1\)/g, '.slice(0)'], [/\.025\b/g, '.05'], [/\.975\b/g, '.95'], [/\b25\b/g, '50'], [/\b100\b/g, '10'], [/\.8\b/g, '.6'],
  [/\b(a|b|i|j|n)\]/g, '$1 + 1]'], [/\? 0 : /g, '? 1 : '], [/\? 1 : /g, '? 0 : '], [/!left/g, 'left'], [/ !/g, ' '],
];
const fnOf = (lines: string[], at: number) => { for (let i = at; i >= 0; i--) { const m = /^(?:export )?(?:async )?(?:function|const) (\w+)/.exec(lines[i]); if (m) return m[1]; } return 'top'; };

const cands: (Mutant & { function: string })[] = [];
for (const f of readdirSync(join(LIB, 'src')).filter(x => x.endsWith('.ts'))) {
  const lines = readFileSync(join(LIB, 'src', f), 'utf8').split('\n');
  lines.forEach((l, i) => {
    const t = l.trim(); if (!t || t.startsWith('//') || t.startsWith('import') || /^export type/.test(t)) return;
    const seen = new Set<string>();
    for (const [re, to] of OPS) for (const m of l.matchAll(re)) {
      const mutated = l.slice(0, m.index) + m[0].replace(new RegExp(re.source), to) + l.slice(m.index! + m[0].length);
      if (mutated !== l && !seen.has(mutated)) { seen.add(mutated); cands.push({ file: `src/${f}`, line: i + 1, original: l, mutated, function: fnOf(lines, i) }); }
    }
  });
}
console.log(`  ${cands.length} one-line mutations to try`);
const kept: { m: typeof cands[0]; failing: string[]; output: string }[] = [];
let done = 0;
const work = async () => { while (cands.length) { const m = cands.shift()!; const dir = plant(m); try { const r = await runSuite(dir, 15_000); if (!r.timedOut && r.failed.length >= 1 && r.failed.length <= 8) kept.push({ m, failing: r.failed, output: firstFailure(r.output) }); } finally { rmSync(dir, { recursive: true, force: true }); } if (++done % 50 === 0) console.log(`  ${done} tried, ${kept.length} kept`); } };
await Promise.all(Array.from({ length: 8 }, work));
const bucket = (s: string) => createHash('sha1').update(s).digest().readUInt32BE(0) % 100;
const db = open(), put = db.prepare('insert or replace into tasks (id, arena, split, input, truth, meta) values (?, ?, ?, ?, ?, ?)'), counts: Record<string, number> = {};
db.exec('begin'); db.prepare(`delete from tasks where arena = 'fixtest'`).run();
const rows: string[] = [];
// whole functions are dealt out, in an order fixed by their hash, each to the split furthest below
// its share (55% to learn from, 25% to race, 20% sealed), so the splits come out near those shares
const byFn = new Map<string, number>(); for (const k of kept) byFn.set(`${k.m.file}:${k.m.function}`, (byFn.get(`${k.m.file}:${k.m.function}`) ?? 0) + 1);
const share: Record<string, number> = { breeding: .55, race: .25, sealed: .2 }, have: Record<string, number> = { breeding: 0, race: 0, sealed: 0 }, splitOfFn = new Map<string, string>();
for (const [fn, n] of [...byFn.entries()].sort((a, b) => b[1] - a[1] || bucket(a[0]) - bucket(b[0]))) {
  const s = Object.keys(share).sort((a, b) => (have[a] - share[a] * kept.length) - (have[b] - share[b] * kept.length))[0];
  splitOfFn.set(fn, s); have[s] += n;
}
for (const { m, failing, output } of kept.sort((a, b) => `${a.m.file}${a.m.line}${a.m.mutated}`.localeCompare(`${b.m.file}${b.m.line}${b.m.mutated}`))) {
  const split = splitOfFn.get(`${m.file}:${m.function}`)!;
  const id = `fixtest:${createHash('sha1').update(`${m.file}:${m.line}:${m.mutated}`).digest('hex').slice(0, 10)}`;
  const mutant = { file: m.file, line: m.line, original: m.original, mutated: m.mutated };
  put.run(id, 'fixtest', split, JSON.stringify({ mutant, failing, output }), JSON.stringify({ ...mutant, function: m.function, failing }), JSON.stringify({ function: m.function }));
  rows.push(`${id}|${JSON.stringify(mutant)}|${failing.join(',')}`); counts[split] = (counts[split] ?? 0) + 1;
}
db.prepare('insert or replace into arenas (id, name, version, hash, built_at) values (?, ?, ?, ?, ?)').run('fixtest', 'Fix the failing test', `beaglelib; ${kept.length} one-line bugs caught by 1 to 8 tests; split by function`, createHash('sha256').update(rows.join('\n')).digest('hex'), new Date().toISOString());
db.exec('commit');
console.log(`  kept ${kept.length}: ${JSON.stringify(counts)}`);
