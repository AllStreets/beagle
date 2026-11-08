// Generation zero: twelve hand-written designs, varied on purpose so the race has something to
// tell apart. Each changes one or two things from its neighbours: model, workflow, tools, memory,
// or how it is told to think.
import type { Genome } from '../../genome.ts';

const PLAIN = 'Read the news item and say where it happened, as the latitude and longitude of the most specific place it names: the town if a town is named, otherwise the region, otherwise the country.';
const CAREFUL = `${PLAIN} Many place names belong to more than one place: use the rest of the item (the country, the region, the people and events in it) to decide which one is meant. If the item is about something that happened in several places, choose the one the item is mainly about.`;
const TOOLED = `${CAREFUL} You can look place names up in a gazetteer. Look up the place before answering, and if it returns several, choose using the country and region the item mentions.`;

const g = (id: string, name: string, model: string, instructions: string, o: Partial<Genome> = {}): Genome =>
  ({ id: `starter-${id}`, name, model, instructions, tools: [], workflow: { shape: 'single' }, memory: { examples: 0 }, ...o });

export function starters(): Genome[] {
  return [
    g('haiku-plain', 'Haiku, one look', 'claude:claude-haiku-4-5', PLAIN),
    g('haiku-careful', 'Haiku, careful', 'claude:claude-haiku-4-5', CAREFUL),
    g('haiku-gazetteer', 'Haiku with the gazetteer', 'claude:claude-haiku-4-5', TOOLED, { tools: ['lookup_place'] }),
    g('haiku-examples', 'Haiku with four examples', 'claude:claude-haiku-4-5', CAREFUL, { memory: { examples: 4 } }),
    g('haiku-check', 'Haiku, checks its work', 'claude:claude-haiku-4-5', TOOLED, { tools: ['lookup_place'], workflow: { shape: 'self-check' } }),
    g('haiku-vote', 'Haiku, three votes', 'claude:claude-haiku-4-5', CAREFUL, { workflow: { shape: 'vote', n: 3 } }),
    g('sonnet-plain', 'Sonnet, one look', 'claude:claude-sonnet-5', PLAIN),
    g('sonnet-plan', 'Sonnet, plans first', 'claude:claude-sonnet-5', TOOLED, { tools: ['lookup_place'], workflow: { shape: 'plan-then-answer' } }),
    g('qwen-plain', 'Qwen 1.7B, one look', 'ollama:qwen3:1.7b', PLAIN),
    g('qwen-gazetteer', 'Qwen 1.7B with the gazetteer', 'ollama:qwen3:1.7b', TOOLED, { tools: ['lookup_place'] }),
    g('llama-careful', 'Llama 8B, careful', 'ollama:llama3.1:8b', CAREFUL, { memory: { examples: 2 } }),
    g('llama-gazetteer', 'Llama 8B with the gazetteer', 'ollama:llama3.1:8b', TOOLED, { tools: ['lookup_place'], memory: { examples: 2 } }),
  ];
}
