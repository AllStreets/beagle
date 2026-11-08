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
