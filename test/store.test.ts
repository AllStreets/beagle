import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.BEAGLE_HOME = mkdtempSync(join(tmpdir(), 'beagle-test-'));

test('opening the store creates every table in a fresh home', async () => {
  const { open } = await import('../src/store.ts');
  const { paths } = await import('../src/paths.ts');
  const db = open();
  assert.ok(existsSync(paths.db));
  const tables = (db.prepare(`select name from sqlite_master where type = 'table'`).all() as { name: string }[]).map(t => t.name).sort();
  for (const t of ['arenas', 'genomes', 'ledger', 'runs', 'settings', 'tasks', 'voyages']) assert.ok(tables.includes(t), `missing ${t}`);
});

test('the ledger sums one voyage, and local calls cost nothing but keep their time', async () => {
  const ledger = await import('../src/ledger.ts');
  ledger.add({ voyage: 'v1', kind: 'race', model: 'claude:claude-haiku-4-5', usd: 0.012, ms: 900 });
  ledger.add({ voyage: 'v1', kind: 'design', model: 'claude:claude-opus-5-5', usd: 0.4, ms: 30000 });
  ledger.add({ voyage: 'v1', kind: 'race', model: 'ollama:qwen3:1.7b', usd: 0, ms: 2500 });
  ledger.add({ voyage: 'v2', kind: 'race', model: 'claude:claude-haiku-4-5', usd: 3, ms: 100 });
  assert.equal(Number(ledger.spent('v1').toFixed(3)), 0.412);
  assert.equal(ledger.time('v1'), 33400);
  assert.equal(ledger.spent('v2'), 3);
});

test('spend can be counted from a moment on, for a generation', async () => {
  const ledger = await import('../src/ledger.ts');
  const since = new Date(Date.now() + 1).toISOString();
  await new Promise(r => setTimeout(r, 5));
  ledger.add({ voyage: 'v1', kind: 'race', model: 'claude:claude-haiku-4-5', usd: 0.5, ms: 10 });
  assert.equal(ledger.spent('v1', since), 0.5);
});
