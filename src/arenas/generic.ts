// What any arena gets when it brings none of its own: hand-written starters across the models,
// and two controls every agent has to beat, the most common answer and one plain Claude call.
import { complete } from '../models/index.ts';
import { open, json } from '../store.ts';
import type { Arena, Control, StarterGenome } from './types.ts';

const PLAIN = 'Read the task carefully and answer exactly in the shape asked for. Think about what the task is really asking before you answer.';
const CAREFUL = 'Read the task carefully. Work out the answer step by step in your head, check it against the task once more, then answer exactly in the shape asked for. Never leave a field empty when the task gives you what you need to fill it.';

export function genericStarters(a: Arena): StarterGenome[] {
  const tools = a.tools.map(t => t.name), id = (s: string) => `${a.id}-${s}`;
  return [
    { id: id('haiku-plain'), name: 'Haiku, one look', model: 'claude:claude-haiku-4-5', instructions: PLAIN, tools: [], workflow: { shape: 'single' }, memory: { examples: 0 } },
    { id: id('haiku-examples'), name: 'Haiku with four examples', model: 'claude:claude-haiku-4-5', instructions: CAREFUL, tools: [], workflow: { shape: 'single' }, memory: { examples: 4 } },
    { id: id('haiku-check'), name: 'Haiku, checks its work', model: 'claude:claude-haiku-4-5', instructions: CAREFUL, tools, workflow: { shape: 'self-check' }, memory: { examples: 0 } },
    { id: id('sonnet-plain'), name: 'Sonnet, one look', model: 'claude:claude-sonnet-5', instructions: PLAIN, tools: [], workflow: { shape: 'single' }, memory: { examples: 0 } },
    { id: id('sonnet-plan'), name: 'Sonnet, plans first', model: 'claude:claude-sonnet-5', instructions: CAREFUL, tools, workflow: { shape: 'plan-then-answer' }, memory: { examples: 2 } },
    { id: id('llama-careful'), name: 'Llama 8B, careful', model: 'ollama:llama3.1:8b', instructions: CAREFUL, tools: [], workflow: { shape: 'single' }, memory: { examples: 2 } },
    { id: id('qwen-coder'), name: 'Qwen coder 7B, careful', model: 'ollama:qwen2.5-coder:7b', instructions: CAREFUL, tools, workflow: { shape: 'single' }, memory: { examples: 2 } },
    { id: id('qwen-small'), name: 'Qwen 1.7B, one look', model: 'ollama:qwen3:1.7b', instructions: PLAIN, tools: [], workflow: { shape: 'single' }, memory: { examples: 0 } },
  ];
}

export function genericControls(a: Arena): Control[] {
  return [
    {
      // the answer that comes up most often among the items agents may learn from
      name: 'most common answer', model: 'none',
      async answer() {
        const rows = open().prepare(`select truth from tasks where arena = ? and split = 'breeding'`).all(a.data) as { truth: string }[];
        const n = new Map<string, number>(); for (const r of rows) n.set(r.truth, (n.get(r.truth) ?? 0) + 1);
        const top = [...n.entries()].sort((x, y) => y[1] - x[1])[0];
        return { answer: top ? json(top[0], null) : null, usd: 0, ms: 0, note: top ? `the most common of ${rows.length} learning items' answers (${top[1]} times)` : 'no learning items' };
      },
    },
    {
      // the least effort with a model: the task, the shape of an answer, nothing else
      name: 'one Claude call', model: 'claude:claude-haiku-4-5',
      async answer(t) {
        const r = await complete('claude:claude-haiku-4-5', [{ role: 'system', content: `${a.describe}\nAnswer with JSON only, in this shape: ${JSON.stringify(a.answer)}` }, { role: 'user', content: a.show(t.input) }], { schema: a.answer });
        return { answer: r.json ?? null, usd: r.usd, ms: r.ms, note: r.text.slice(0, 400) };
      },
    },
  ];
}
