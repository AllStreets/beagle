// Your own arena: a folder with arena.json, tasks.jsonl and grade.ts becomes an arena that races.
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-custom-'));
let C: typeof import('../src/arenas/custom.ts'), R: typeof import('../src/race.ts'), M: typeof import('../src/models/index.ts'), A: typeof import('../src/arenas/index.ts'), store: typeof import('../src/store.ts');

function folder(id: string, n: number, grade = `export default (a: any, t: any) => String(a?.word).toLowerCase() === String(t.word).toLowerCase() ? 1 : 0;`) {
  const dir = mkdtempSync(join(tmpdir(), `arena-${id}-`));
  writeFileSync(join(dir, 'arena.json'), JSON.stringify({ id, name: 'Opposites', describe: 'Give the opposite of the word.', answer: { type: 'object', required: ['word'], properties: { word: { type: 'string' } } } }));
  writeFileSync(join(dir, 'tasks.jsonl'), Array.from({ length: n }, (_, i) => JSON.stringify({ id: `o${i}`, input: `word ${i}`, truth: { word: i % 2 ? 'cold' : 'hot' } })).join('\n'));
  writeFileSync(join(dir, 'grade.ts'), grade);
  return dir;
}

before(async () => { C = await import('../src/arenas/custom.ts'); R = await import('../src/race.ts'); M = await import('../src/models/index.ts'); A = await import('../src/arenas/index.ts'); store = await import('../src/store.ts'); });
afterEach(() => M.setDriver(null));

test('a folder becomes an arena, split by a hash of each task into breeding, race and sealed', async () => {
  const r = await C.addArena(folder('opposites', 200));
  assert.equal(r.id, 'opposites');
  assert.equal(r.counts.breeding + r.counts.race + r.counts.sealed, 200);
  assert.ok(r.counts.breeding > 90 && r.counts.race > 30 && r.counts.sealed > 15, JSON.stringify(r.counts));
  // the split depends on the task, not on the order of the file
  const again = await C.addArena(folder('opposites', 200));
  assert.deepEqual(again.counts, r.counts);
  assert.equal(A.getArena('opposites').name, 'Opposites');
});

test('its voyage races its own grader, with generic starters and its two controls', async () => {
  M.setDriver(async (_p, _n, turns) => ({ text: `{"action":"answer","answer":{"word":"${/word \d*[13579]\b/.test(turns.at(-1)!.content) ? 'cold' : 'hot'}"}}`, usd: 0, ms: 1 }));
  const v = R.startVoyage('opposites', { raceTasks: 10, capGeneration: 100 });
  const starters = A.startersFor('opposites');
  assert.ok(starters.length >= 4);
  const r = await R.race(v.id, 0, starters.slice(0, 2) as any);
  assert.equal(r.complete, true);
  assert.equal(r.scores.find(s => !s.genome.startsWith('baseline:'))!.mean, 1);
  assert.ok(r.scores.some(s => s.genome === 'baseline:most common answer'));
  assert.ok(r.scores.some(s => s.genome === 'baseline:one Claude call'));
});

test('custom arenas come back after a restart', async () => {
  A.unregisterArena('opposites');
  assert.throws(() => A.getArena('opposites'));
  await C.loadCustomArenas();
  assert.equal(A.getArena('opposites').id, 'opposites');
});

test('a folder is refused with a reason when it is not an arena', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bad-')); mkdirSync(join(dir, 'x'));
  await assert.rejects(C.addArena(dir), /arena\.json/);
  await assert.rejects(C.addArena(folder('tiny', 5)), /at least 20 tasks/);
  await assert.rejects(C.addArena(folder('geotag', 40)), /already/);
});

test('a grader that never returns scores the run 0 after its time, and the race goes on', async () => {
  await C.addArena(folder('stuck', 40, 'export default () => new Promise(() => {});'));
  (A.getArena('stuck') as any).graderTimeoutMs = 50;
  M.setDriver(async () => ({ text: '{"action":"answer","answer":{"word":"hot"}}', usd: 0, ms: 1 }));
  const v = R.startVoyage('stuck', { raceTasks: 4, capGeneration: 100 });
  const r = await R.race(v.id, 0, A.startersFor('stuck').slice(0, 1) as any, { baselines: false });
  assert.equal(r.complete, true); assert.equal(r.scores[0].mean, 0);
});
