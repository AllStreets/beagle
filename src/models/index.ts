// One way to ask any model a question. A model id names its provider: claude:<name> runs
// through the person's own Claude Code, headless; ollama:<name> runs on this Mac.
import { claude } from './claude.ts';
import { ollama } from './ollama.ts';

export type Turn = { role: 'system' | 'user' | 'assistant'; content: string };
export type Reply = { text: string; json?: unknown; usd: number; ms: number };
export type Driver = (provider: 'claude' | 'ollama', name: string, turns: Turn[], o: { schema?: object; timeoutMs?: number }) => Promise<Omit<Reply, 'json'>>;

// A usage window or rate limit was hit. Whoever called should wait and try again, not score it.
export class LimitError extends Error { name = 'LimitError'; }

const real: Driver = (provider, name, turns, o) => provider === 'claude' ? claude(name, turns, o) : ollama(name, turns, o);
let driver: Driver = real;
// Tests stand in a fake here; null puts the real one back.
export function setDriver(d: Driver | null) { driver = d ?? real; }

export async function complete(model: string, turns: Turn[], o: { schema?: object; timeoutMs?: number } = {}): Promise<Reply> {
  const i = model.indexOf(':'), provider = model.slice(0, i), name = model.slice(i + 1);
  if (provider !== 'claude' && provider !== 'ollama') throw new Error(`unknown model provider "${provider}" in "${model}"`);
  const r = await driver(provider, name, turns, o);
  const reply: Reply = { ...r, usd: provider === 'ollama' ? 0 : r.usd };
  if (o.schema) { try { reply.json = JSON.parse(r.text); } catch { /* the caller decides what a malformed answer means */ } }
  return reply;
}
