# An example arena: what day of the week was it?

A date between 1600 and 2200, written out in words; the answer is its weekday. Language models are poor at this without a method, which leaves evolution something real to find.

    npx tsx make-tasks.ts          # writes tasks.jsonl (400 dates, fixed seed)
    beagle arena add .
    beagle voyage start weekday --race-tasks 40

An arena is any folder with these three files:

- `arena.json`: its id, a name, the task as an agent is told it, and a JSON schema for an answer.
- `tasks.jsonl`: one task a line, `{ "id", "input", "truth" }`. At least 20.
- `grade.ts`: a default export scoring an answer against a truth from 0 to 1. It may be async; one that throws or runs over two minutes scores 0.

Beagle splits the tasks by a hash of each id: about 60% to learn from, 25% to race on, 15% sealed.
