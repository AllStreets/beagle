import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { complete, setDriver, LimitError, type Driver } from '../src/models/index.ts';

afterEach(() => setDriver(null));

test('a model id is routed to its provider by its prefix', async () => {
  const seen: string[] = [];
  const fake: Driver = async (provider, name) => { seen.push(`${provider}/${name}`); return { text: 'ok', usd: provider === 'claude' ? .01 : 0, ms: 5 }; };
  setDriver(fake);
  await complete('claude:claude-haiku-4-5', [{ role: 'user', content: 'hi' }]);
  await complete('ollama:qwen3:1.7b', [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(seen, ['claude/claude-haiku-4-5', 'ollama/qwen3:1.7b']);
});

test('an unknown provider is refused with a reason', async () => {
  await assert.rejects(complete('gpt:4', [{ role: 'user', content: 'hi' }]), /unknown model provider "gpt"/);
});

test('a usage limit passes through as a LimitError, untouched', async () => {
  setDriver(async () => { throw new LimitError('usage limit reached; resets at 3pm'); });
  await assert.rejects(complete('claude:claude-haiku-4-5', [{ role: 'user', content: 'hi' }]), (e: unknown) => e instanceof LimitError && /resets at 3pm/.test((e as Error).message));
});

test('a local call is always recorded as free', async () => {
  setDriver(async () => ({ text: '{}', usd: 9, ms: 5 }));
  const r = await complete('ollama:qwen3:1.7b', [{ role: 'user', content: 'hi' }]);
  assert.equal(r.usd, 0);
});

test('a schema answer is parsed into json', async () => {
  setDriver(async () => ({ text: '{"lat": 49.48, "lon": 8.47}', usd: 0, ms: 5 }));
  const r = await complete('ollama:qwen3:1.7b', [{ role: 'user', content: 'where' }], { schema: { type: 'object' } });
  assert.deepEqual(r.json, { lat: 49.48, lon: 8.47 });
});

test('Claude Code\'s session-limit message is read as a usage limit', async () => {
  const { isLimit } = await import('../src/models/claude.ts');
  assert.ok(isLimit("You've hit your session limit · resets 4pm (America/Chicago)"));
  assert.ok(isLimit('Claude AI usage limit reached|1762650000'));
  assert.ok(!isLimit('claude exited 1: unknown option --foo'));
});
