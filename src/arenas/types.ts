// An arena is a kind of task with a way to grade it. Agents may use its tools.
export type ToolSpec = {
  name: string;
  describe: string;                          // what the tool does, for the model
  args: object;                              // JSON schema of its arguments
  run(args: any): Promise<unknown> | unknown;
};

export type Arena = {
  id: string;
  name: string;
  describe: string;                          // the task, in plain words, as an agent is told it
  answer: object;                            // JSON schema of an answer
  grade(answer: unknown, truth: unknown): number;   // 0 to 1
  tools: ToolSpec[];
  show(input: unknown): string;              // the task as the agent sees it
};
