import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-fossil-'));

test('answers are grouped into cells of the globe; rare cells fold into their nearest common one', async () => {
  const { makeCells } = await import('../src/fossil.ts');
  const pts = [{ lat: 49.4, lon: 8.4 }, { lat: 49.6, lon: 8.3 }, { lat: 32.8, lon: 35.0 }, { lat: 32.9, lon: 35.1 }, { lat: 33.4, lon: 35.6 }];
  const c = makeCells(pts, 2);
  assert.equal(c.centres.length, 2, 'two cells hold two or more answers');
  assert.equal(c.of[4], c.of[2], 'the lone answer near Haifa joins the Haifa cell');
  const haifa = c.centres[c.of[2]];
  assert.ok(Math.abs(haifa.lat - 33.03) < .05, 'a cell is centred on the mean of its answers');
});

test('the fossil is judged on the race items against the truth, and its teacher on the same items', async () => {
  const { judgeFossil } = await import('../src/fossil.ts');
  const truth = [{ places: [{ name: 'A', lat: 10, lon: 10 }] }, { places: [{ name: 'B', lat: 50, lon: 8 }] }];
  const r = judgeFossil({ predicted: [{ lat: 10, lon: 10 }, { lat: 20, lon: 20 }], truth, teacherScores: [1, 1] });
  assert.equal(r.score, .5); assert.equal(r.teacher, 1);
  assert.equal(r.agreement, .5, 'it matches its teacher on one of two');
  assert.equal(r.standsIn, false, 'more than 5 points behind its teacher, so it does not stand in');
});

test('a fossil stays warm and answers one new item with its most likely places, in order', { skip: !(await import('node:fs')).existsSync(join(import.meta.dirname, '..', 'trainer', '.venv', 'bin', 'python')) && 'no MLX environment' }, async () => {
  const { writeFileSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { askNetwork, closeFossils } = await import('../src/fossil.ts');
  // a tiny made-up fossil: items near one direction belong to cell 0, the opposite to cell 1
  const dir = mkdtempSync(join(tmpdir(), 'tiny-fossil-')), x: number[][] = [], y: number[] = [];
  for (let i = 0; i < 200; i++) { const s = i % 2 ? 1 : -1; x.push([s + Math.sin(i) * .1, -s, s * .5, Math.cos(i) * .1]); y.push(i % 2); }
  writeFileSync(join(dir, 'dataset.json'), JSON.stringify({ x, y, n_cells: 2 }));
  const py = join(import.meta.dirname, '..', 'trainer', '.venv', 'bin', 'python');
  assert.equal(spawnSync(py, [join(import.meta.dirname, '..', 'trainer', 'train.py'), join(dir, 'dataset.json'), dir, '--epochs', '20']).status, 0);
  const a = await askNetwork(dir, 4, 2, [1, -1, .5, 0]);
  assert.equal(a.top[0].cell, 1); assert.ok(a.top[0].p > .5 && a.top[0].p <= 1);
  assert.equal(a.top.length, 2); assert.ok(a.top[0].p >= a.top[1].p);
  const b = await askNetwork(dir, 4, 2, [-1, 1, -.5, 0]);
  assert.equal(b.top[0].cell, 0, 'the same warm process answers again');
  assert.ok(b.ms < 50, `a warm answer takes ${b.ms} ms`);
  closeFossils();
});
