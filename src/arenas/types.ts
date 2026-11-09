// An arena is a kind of task with a way to grade it. Agents may use its tools.
export type ToolSpec = {
  name: string;
  describe: string;                          // what the tool does, for the model
  args: object;                              // JSON schema of its arguments
  run(args: any, ctx?: { task: { id: string; input: unknown } }): Promise<unknown> | unknown;   // ctx: the task the run is on
};

export type Arena = {
  id: string;
  data: string;                              // whose tasks it uses: variants of one arena share them
  name: string;
  describe: string;                          // the task, in plain words, as an agent is told it
  answer: object;                            // JSON schema of an answer
  grade(answer: unknown, truth: unknown): number | Promise<number>;   // 0 to 1
  tools: ToolSpec[];
  show(input: unknown): string;              // the task as the agent sees it
  // optional, with plain defaults (see hooks in index.ts)
  valid?(answer: unknown): boolean;          // is this an answer at all
  merge?(answers: unknown[]): unknown;       // a vote's answer
  example?(truth: unknown): string;          // a worked example's answer, as the agent is shown it
  miss?(answer: unknown, truth: unknown): string;   // how an answer went wrong, for the designer
  maxTurns?: number;                         // model turns a run may take
  graderTimeoutMs?: number;
  inBrowser?: boolean;                       // the grader can run in a browser (the log's re-grade)
  brief?(input: unknown): string;            // one line about an item, for lists
  fromText?(text: string, date: string): unknown;   // an item a person typed, for 'set your own item'
  kind?: 'geotag' | 'receipts' | 'fixtest' | 'custom';
  starters?(): StarterGenome[];              // the hand-written agents of generation one
  controls?(): Control[];                    // what every agent has to beat
};
export type StarterGenome = { id: string; name: string; model: string; instructions: string; tools: string[]; workflow: { shape: 'single' | 'plan-then-answer' | 'self-check' | 'vote'; n?: number }; memory: { examples: number } };
export type Control = { name: string; model: string; answer(task: { id: string; input: unknown }): Promise<{ answer: unknown | null; usd: number; ms: number; note: string }> };
