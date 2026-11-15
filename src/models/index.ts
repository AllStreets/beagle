// One way to ask any model a question. A model id names its provider: claude:<name> runs
// through the person's own Claude Code, headless; ollama:<name> runs on this Mac; mlx:<name> is a
// model on this Mac that a program importing Beagle serves through its own driver.
import { claude } from './claude.ts';
import { ollama } from './ollama.ts';

export type Turn = { role: 'system' | 'user' | 'assistant'; content: string };
export type Reply = { text: string; json?: unknown; usd: number; ms: number };
export type Provider = 'claude' | 'ollama' | 'mlx';
export type CallOptions = { schema?: object; timeoutMs?: number; signal?: AbortSignal };
export type Driver = (provider: Provider, name: string, turns: Turn[], o: CallOptions) => Promise<Omit<Reply, 'json'>>;
const PROVIDERS: Provider[] = ['claude', 'ollama', 'mlx'];

// A usage window or rate limit was hit. Whoever called should wait and try again, not score it.
export class LimitError extends Error { name = 'LimitError'; }

const real: Driver = (provider, name, turns, o) => {
  if (provider === 'claude') return claude(name, turns, o);
  if (provider === 'ollama') return ollama(name, turns, o);
  throw new Error(`Beagle has no mlx server of its own; a program that runs mlx:${name} sets a driver for it`);
};
let driver: Driver = real;
// Tests stand in a fake here; null puts the real one back.
export function setDriver(d: Driver | null) { driver = d ?? real; }

// signal: the caller's stop; a driver ends its call when it fires
export async function complete(model: string, turns: Turn[], o: CallOptions = {}): Promise<Reply> {
  const i = model.indexOf(':'), provider = model.slice(0, i) as Provider, name = model.slice(i + 1);
  if (!PROVIDERS.includes(provider)) throw new Error(`unknown model provider "${provider}" in "${model}"`);
  o.signal?.throwIfAborted();
  const r = await driver(provider, name, turns, o);
  const reply: Reply = { ...r, usd: provider === 'claude' ? r.usd : 0 };
  if (o.schema) { try { reply.json = JSON.parse(r.text); } catch { /* the caller decides what a malformed answer means */ } }
  return reply;
}
