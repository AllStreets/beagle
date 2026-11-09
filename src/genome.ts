// An agent, written down as data: what it is told, which model runs it, which tools it may
// use, how its steps are wired, and how many worked examples it is shown. Data can be diffed,
// crossed and stored, which is what lets Beagle breed agents.
export type Shape = 'single' | 'plan-then-answer' | 'self-check' | 'vote';
export type Genome = {
  id: string;
  name: string;
  model: string;                              // claude:<name> or ollama:<name>
  instructions: string;
  tools: string[];
  workflow: { shape: Shape; n?: number };     // n: how many answers a vote takes
  memory: { examples: number };               // worked examples from the breeding split
};

export const TOOLS = ['lookup_place'];
const SHAPES: Shape[] = ['single', 'plan-then-answer', 'self-check', 'vote'];

// tools: the names this genome's arena offers (geotagging's lookup by default)
export function validate(x: unknown, tools: string[] = TOOLS): Genome {
  const g = x as Genome;
  if (!g || typeof g !== 'object') throw new Error('not a genome');
  const bad = (why: string) => { throw new Error(`genome "${g.name ?? g.id ?? '?'}": ${why}`); };
  if (!g.id || !g.name) bad('needs an id and a name');
  if (typeof g.model !== 'string' || !/^(claude|ollama):\S+$/.test(g.model)) bad('model must be claude:<name> or ollama:<name>');
  if (typeof g.instructions !== 'string' || !g.instructions.trim()) bad('instructions are empty');
  if (!Array.isArray(g.tools)) bad('tools must be a list');
  for (const t of g.tools) if (!tools.includes(t)) bad(`unknown tool "${t}"${tools.length ? ` (this arena has ${tools.join(', ')})` : ' (this arena has no tools)'}`);
  if (!g.workflow || !SHAPES.includes(g.workflow.shape)) bad(`workflow shape must be one of ${SHAPES.join(', ')}`);
  if (g.workflow.shape === 'vote') {
    if (g.workflow.n === undefined) bad('a vote needs n, how many answers it takes');
    if (!Number.isInteger(g.workflow.n) || g.workflow.n! < 2 || g.workflow.n! > 7) bad('n must be 2 to 7');
  }
  if (!g.memory || !Number.isInteger(g.memory.examples) || g.memory.examples < 0 || g.memory.examples > 8) bad('examples must be 0 to 8');
  return g;
}
