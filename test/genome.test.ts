import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, type Genome } from '../src/genome.ts';
import { starters } from '../src/arenas/geotag/starters.ts';

const ok: Genome = { id: 'g1', name: 'Plain Haiku', model: 'claude:claude-haiku-4-5', instructions: 'Say where it happened.', tools: [], workflow: { shape: 'single' }, memory: { examples: 0 } };

test('twelve starters, all valid, varied in model, shape, tools and memory', () => {
  const s = starters();
  assert.equal(s.length, 12);
  for (const g of s) validate(g);
  assert.equal(new Set(s.map(g => g.id)).size, 12, 'ids are unique');
  assert.equal(new Set(s.map(g => g.name)).size, 12, 'names are unique');
  for (const m of ['claude:claude-haiku-4-5', 'claude:claude-sonnet-5', 'ollama:qwen3:1.7b', 'ollama:llama3.1:8b']) assert.ok(s.some(g => g.model === m), `no starter on ${m}`);
  for (const shape of ['single', 'plan-then-answer', 'self-check', 'vote']) assert.ok(s.some(g => g.workflow.shape === shape), `no ${shape}`);
  assert.ok(s.some(g => g.tools.includes('lookup_place')) && s.some(g => !g.tools.length));
  assert.ok(s.some(g => g.memory.examples === 0) && s.some(g => g.memory.examples > 0));
});

test('a valid genome passes as it is', () => {
  assert.deepEqual(validate(ok), ok);
});

test('a broken genome is refused, saying what is wrong', () => {
  assert.throws(() => validate({ ...ok, tools: ['search_web'] }), /unknown tool "search_web"/);
  assert.throws(() => validate({ ...ok, workflow: { shape: 'vote' } }), /vote needs n/);
  assert.throws(() => validate({ ...ok, workflow: { shape: 'vote', n: 9 } }), /n must be 2 to 7/);
  assert.throws(() => validate({ ...ok, model: 'gpt-5' }), /model must be claude:<name> or ollama:<name>/);
  assert.throws(() => validate({ ...ok, instructions: '' }), /instructions/);
  assert.throws(() => validate({ ...ok, memory: { examples: 40 } }), /examples must be 0 to 8/);
  assert.throws(() => validate(null), /not a genome/);
});
