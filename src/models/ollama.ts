import type { Turn } from './index.ts';

const HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

// A model running on this Mac through Ollama. A schema becomes Ollama's structured output.
export async function ollama(name: string, turns: Turn[], o: { schema?: object; timeoutMs?: number }): Promise<{ text: string; usd: number; ms: number }> {
  const t0 = Date.now();
  const r = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(o.timeoutMs ?? 300_000),
    body: JSON.stringify({ model: name, messages: turns, stream: false, think: false, format: o.schema, options: { temperature: 0.2 } }),
  });
  if (!r.ok) throw new Error(`ollama ${name}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const d = await r.json() as { message?: { content?: string } };
  return { text: d.message?.content ?? '', usd: 0, ms: Date.now() - t0 };
}
