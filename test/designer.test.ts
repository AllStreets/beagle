import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-designer-'));
let M: typeof import('../src/models/index.ts'), R: typeof import('../src/race.ts'), D: typeof import('../src/designer.ts');
const g = (id: string, model = 'claude:claude-haiku-4-5') => ({ id, name: id, model, instructions: 'Answer.', tools: [], workflow: { shape: 'single' as const }, memory: { examples: 0 } });

before(async () => {
  M = await import('../src/models/index.ts'); R = await import('../src/race.ts'); D = await import('../src/designer.ts');
  const { open } = await import('../src/store.ts');
  const put = open().prepare('insert into tasks (id, arena, split, input, truth, meta) values (?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 6; i++) put.run(`r${i}`, 'geotag', 'race', JSON.stringify({ text: `RACEITEM ${i}`, hidden: `RACEITEM ${i}`, date: '2024-06-01' }), JSON.stringify({ places: [{ name: 'X', lat: 10, lon: 10 }] }), '{}');
  for (let i = 0; i < 12; i++) put.run(`b${i}`, 'geotag', 'breeding', JSON.stringify({ text: `breeding item ${i}`, hidden: `breeding item ${i}`, date: '2024-01-01' }), JSON.stringify({ places: [{ name: 'Y', lat: 20, lon: 20 }] }), '{}');
  put.run('s0', 'geotag', 'sealed', JSON.stringify({ text: 'SEALEDITEM', hidden: 'SEALEDITEM', date: '2025-05-01' }), JSON.stringify({ places: [{ name: 'Z', lat: 30, lon: 30 }] }), '{}');
});
afterEach(() => M.setDriver(null));

test('the designer sees breeding failures and race scores, never a race or sealed item', async () => {
  const prompts: string[] = [];
  M.setDriver(async (_p, name, turns) => {
    const all = turns.map(t => t.content).join('\n');
    if (all.includes('design the next generation')) {
      prompts.push(all);
      return { text: JSON.stringify({ children: [
        { name: 'Haiku, reads the clues', parents: ['a'], model: 'claude:claude-haiku-4-5', instructions: 'Use every clue: people, groups, events.', tools: ['lookup_place'], workflow: { shape: 'single' }, memory: { examples: 2 }, reason: 'a missed items where the group named the region' },
        { name: 'Broken', parents: ['a'], model: 'gpt:5', instructions: 'x', tools: [], workflow: { shape: 'single' }, memory: { examples: 0 }, reason: 'bad' },
        { name: 'Orphan', parents: ['nobody'], model: 'ollama:qwen3:1.7b', instructions: 'Answer well.', tools: [], workflow: { shape: 'single' }, memory: { examples: 0 }, reason: 'no parent' },
      ] }), usd: .5, ms: 10 };
    }
    return { text: name.includes('bad') ? '{"action":"answer","answer":{"lat":-40,"lon":10}}' : '{"action":"answer","answer":{"lat":20,"lon":20}}', usd: .01, ms: 2 };
  });
  const v = R.startVoyage('geotag', { raceTasks: 6, capGeneration: 100 });
  await R.race(v.id, 0, [g('a'), g('b', 'claude:bad')], { baselines: false });
  const out = await D.breed(v.id, 0, { children: 3, elites: 1, probe: 4 });
  assert.equal(prompts.length, 1);
  assert.doesNotMatch(prompts[0], /RACEITEM|SEALEDITEM/, 'no race or sealed item text reaches the designer');
  assert.match(prompts[0], /breeding item/, 'it sees failures on breeding items');
  // elites carry over unchanged; the valid child keeps its parent and reason; bad ones are refused with why
  assert.deepEqual(out.next.map(x => x.name), ['a', 'Haiku, reads the clues']);
  const child = out.next[1];
  assert.notEqual(child.id, 'a'); assert.deepEqual(out.parents[child.id], ['a']); assert.match(out.reasons[child.id], /missed items/);
  assert.equal(out.refused.length, 2);
  assert.match(out.refused.map(r => r.why).join(' '), /model must be|parent/);
  // a kept agent is in both generations: breeding must not move it out of the one it raced in
  const { open } = await import('../src/store.ts');
  const gens = (open().prepare('select generation from genomes where voyage = ? and id = ? order by generation').all(v.id, 'a') as { generation: number }[]).map(r => r.generation);
  assert.deepEqual(gens, [0, 1]);
  // the probe and the design are paid for, and counted against the next generation
  const L = await import('../src/ledger.ts');
  assert.ok(L.spentOnGeneration(v.id, 1) >= .5);
});
