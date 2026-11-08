# Beagle: design

Written 2026-11-08 from a pitch Connor chose over a second idea (Boomtown, saved for later; Beagle may become Boomtown's school). Lines marked *(call)* are decisions made in writing this, open to change; the rest is his.

## Intent

Agents that evolve agents. Give Beagle a kind of task with a way to grade it. It breeds a population of agent designs, races them on real held-out tasks, has the winners' designs studied and rewritten into the next generation by a designer agent, and, once a winner is good and stable, compresses its skill into a small neural network trained on the Mac that answers in milliseconds and costs nothing to run.

He chose it because it is the more impressive idea "from a recursive learning perspective and a scientific context": agents that design agents, and skills memorised into weights. It must clear his bar for a flagship: the feeling, from CORANTO, Bombechat, Chicago Open World, AgentZeus, Foundry, the Flexport dashboard and F1 Pixel Cup, of "I can't believe Claude Code and orchestrating agents could lead to this".

The name is Darwin's ship. The interface is a naturalist's cabinet from that voyage.

## Goals

1. **Arenas.** A task type with a dataset and a grader, split into a breeding set (the designer may see failures here), a race set (fitness), and a sealed test set (reported, never shown to the designer). Three ship: headline geotagging, fixing a failing test, extracting fields from documents. Anyone can add one: a folder with tasks and a grader.
2. **Genomes.** An agent is a genome: instructions, model, tools, workflow shape (single answer, plan then answer, self-check, vote of several, sub-agents), and memory (worked examples chosen from the breeding set). Genomes are data, so they can be diffed, crossed and stored.
3. **The race.** Every genome in a generation runs the same race set in parallel under a spend cap. Fitness is accuracy first, then cost and speed, as a Pareto rank. Every run is recorded and can be inspected.
4. **Breeding.** A designer agent (Claude) reads the fittest genomes and the failure traces of the rest on the breeding set, and writes the next generation: mutations, crossovers, and new sub-agents a winner's traces show it needed. Every child carries a written reason. Elites survive unchanged; some diversity is kept on purpose so the population does not collapse onto one design.
5. **Fossilising.** When the best genome is stable for a set number of generations, Beagle runs it over a large unlabelled pool to make a teaching set, trains a small network on it with MLX on the Mac, and measures the fossil honestly against both the teacher and the sealed test set: accuracy, speed, cost. A fossil that clears a bar can stand in for the LLM call in that skill, and later genomes may use fossils as tools.
6. **The cabinet.** All of it is visible as it happens, in a photoreal naturalist's cabinet.

## Non-goals

- Training large models. Fossils are small: a network trained from scratch where the task allows it, or a low-rank fine-tune of a model around half a billion parameters.
- Running untrusted code outside a sandbox. Code-fixing agents work in throwaway clones.
- A hosted service. It runs on the person's Mac.

## Anti-goals

- Theatre over substance. Every number shown is measured, every claim checkable, every model's accuracy reported on data it never trained on. A fossil that loses accuracy says so.
- Generic AI look, in the cabinet or anywhere. (His list: no caps eyebrows, card kits, glow, decorative chart motifs, mono as decoration.)
- Runaway spend. Each generation has a hard dollar cap and stops at it.

## The arenas

**Geotagging headlines** *(call: first arena)*. Input: a one-line news item. Output: a latitude and longitude. Ground truth: Wikipedia's daily Current Events pages, where each item links to the place it happened; the place's coordinates come from Wikidata. A few thousand items from 2023 to 2025. Grade: 1 within 25 km, falling smoothly to 0 at 2,500 km. It ties to CORANTO, is cheap to run, and is a good fossil: a small network can learn it. Tools available to genomes: an offline gazetteer (GeoNames cities and admin areas) for name lookup.

**Fixing a failing test** *(call)*. Bugs are made by mutation: take small known-good open-source TypeScript or Python libraries with good tests, apply a single code mutation that makes a test fail, and ask the agent to make the suite pass without touching tests. Ground truth is the test suite. Agents work in APFS clones. Fossilising is not attempted here; this arena is about evolving workflow and tools.

**Extracting fields from documents** *(call)*. A public labelled dataset of receipts or invoices with their text (for example CORD), fields graded by exact and fuzzy match. A good second fossil.

**Your own arena.** A folder with `tasks.jsonl` and `grade.ts`; Beagle splits it.

## How the work is split

| Job | Runs on |
| --- | --- |
| Racing genomes | Whatever model each genome names: Claude (haiku, sonnet) through Claude Code headless, or local models in Ollama |
| Designing the next generation | Claude, the strongest model |
| Training fossils | MLX on the Mac, in a Python environment Beagle manages |
| Grading, scheduling, records | Plain code |

Claude calls reuse Understudy's lean headless wrapper: no settings, plugins, MCP or session saving, so a call costs what its prompt costs.

## The cabinet *(calls throughout, to be mocked up and chosen like Understudy's book)*

A mahogany specimen cabinet on a desk, lit like a museum case.

- **Specimens.** Each genome of the current generation is a glass jar on a shelf with a handwritten label: its name, its lineage, its fitness. The jar's contents are drawn from its genome (its workflow as a small structure suspended in the jar), so different designs look different.
- **The race.** The shelf becomes a running board while a generation races: each jar's score fills as its tasks come back, and failures mark the label.
- **The field journal.** The lineage, drawn in ink as a branching tree in Darwin's notebook style, generation by generation. Extinct lines fade.
- **The microscope.** Inspect a genome: its instructions, tools, workflow and the designer's written reason for it, and the diff from its parent.
- **The fossil slab.** A trained network pressed into stone, with its size, speed and accuracy engraved, and its training curve as a strata line.
- **The arena drawer.** The task set, with a sample of tasks and their grades.

## Architecture *(calls)*

- Mac app in Tauri, like Bombechat; the cabinet in three.js; the engine in TypeScript on Node with `node:sqlite`; training in Python with MLX, run as a subprocess in a `uv`-managed environment.
- Engine: `arena` (load, split, grade), `genome` (schema, validation), `runner` (execute a genome on a task with tools and budget), `race` (a generation in parallel), `designer` (breed the next generation), `fossil` (teach set, training, evaluation, serving), `ledger` (every run, every dollar).
- Records: every task run stores the genome, inputs, outputs, tool calls, grade, cost and time.

## Phases

1. One arena (geotagging) and one live race: the dataset built, generation zero designed and raced, the cabinet showing real specimens with real scores.
2. Breeding and the field journal over several generations.
3. Fossilising: the first locally trained network standing in for a winning genome.
4. The other two arenas, and arenas you define yourself.

## Settled after the builder check

- **Tools run in Beagle's own loop** *(call)*. A genome's model answers one turn at a time with either a tool request or an answer, as structured output; Beagle runs the tool and feeds the result back. Claude (headless, through the lean wrapper, tools off) and Ollama are driven the same way, so traces, step costs and the "vote" and "sub-agent" workflow shapes all live in Beagle, not inside Claude Code.
- **The designer composes; it does not write tool code** *(call, for the first build)*. It may write new instructions, rewire workflows, change models and memory, and define sub-agents made of prompts and existing tools. New tool code is a later step, because it needs a sandbox and a defence against tools that read the grader.
- **A fossil stands in when** *(call)* it scores within 5 points of its teacher on the sealed test set (on a 0 to 100 scale), and it replaces the whole genome for that arena. Later genomes may call a fossil as a tool.
- **The unlabelled pool for teaching fossils** *(call)* is Current Events items from dates outside the labelled range, with any item whose text or linked place set matches a sealed test item removed. Wikipedia text is CC BY-SA and read through its public API with a plain user agent.
- **The machine** is Connor's M5 Pro with 64 GB, so racing on local models and training can overlap; the scheduler still runs at most one MLX training job at a time.
- **The cabinet** is mocked up as three concepts for Connor to choose from, as with Understudy, and that choice is a stop point before the cabinet is built for real. Materials are made procedurally in code (wood grain, glass, stone, paper), as Understudy's and Bombechat's were; no bought or generated assets.

## Two ways in

Beagle is for a research scientist and for someone who has never heard the word "genome" in this sense, so every screen works at two depths, switched per screen or in Settings.

- **Plain view** (the default). One question at a time: "What do you want an agent to get good at?" Pick an arena, press "Begin a voyage". The cabinet says what is happening in plain sentences, with numbers a person can picture: "Generation 3 is racing. The best so far puts 81 of 100 headlines within 25 km of where they happened." Every term of art (genome, fitness, fossil, Pareto) has a one-line meaning on hover, in plain words.
- **Lab view.** The same voyage in full: the accuracy, cost and speed front, confidence intervals, every task's full trace, genome diffs, seeds, dataset and model versions, and exports. Everything in the app can also be done from the command line.

## Proof that the results are real

Beagle's claims are measured, and anyone can check them.

1. **The sealed test is fixed before the voyage starts.** Its contents are fingerprinted (a content hash) and the fingerprint is printed on the voyage's first page before generation zero runs: a pre-registration. The designer never sees it, and sealed scores are only computed at the end. The fingerprint lets anyone confirm later that it was not changed.
2. **Baselines on the same tasks, always shown alongside.** For geotagging: a random point; the gazetteer alone with no model (first place name found, largest population); the hand-written starter agent; a single plain Claude call. An evolved agent's score means little without them.
3. **Uncertainty.** Scores carry 95% bootstrap intervals, and Beagle only says one agent is better than another when the intervals separate.
4. **Every number opens its evidence.** Click any score to reach the runs behind it: the task, the agent's every turn and tool call, its answer, the truth, the grade.
5. **Re-grade without trusting Beagle.** A voyage exports as a bundle (genomes, every answer, the dataset version and hash, model names and versions, seeds). `beagle regrade bundle` re-scores every answer from the bundle with no model calls.
6. **Fossils are reported straight.** Accuracy against the truth and against the teacher on the sealed test, time per answer measured on this machine, size on disk, and the training curve with held-out loss. A fossil that is worse says so.
7. **Spend is a ledger.** Every Claude call's reported cost; local calls count as free, with their time.
8. **Nothing is made up for display.** Anything not yet measured reads "not measured". No placeholder numbers, no sample charts.

## Settings

- **Models.** Which Claude models genomes and the designer may use; Ollama models found on this Mac and whether they are running; the MLX environment and whether it is native Apple silicon.
- **Spend.** A cap per generation ($5) and per voyage ($25), in Claude Code's reported cost, which on a Claude plan counts against usage limits rather than a bill; how many runs at once; a local-only mode that never calls Claude.
- **Evolution.** Population size, generations, how many elites survive, how much diversity to keep, how bold mutations are, which model designs.
- **Fossils.** Fossilise automatically or only on request; the stand-in bar (within 5 points of the teacher); a training time limit.
- **Arenas.** Data sources and their versions, refresh, add an arena from a folder.
- **Data.** Where voyages are kept, export, delete.
- **Display.** Plain or lab view, reduced motion, text size, keyboard shortcuts.
- **About.** Versions, and credits and licences for the data (Wikipedia text CC BY-SA, Wikidata CC0, GeoNames CC BY).

## Interface standards

- **Type.** None of the faces that mark generated UI: Inter, Geist, Space Grotesk, the IBM Plex family, JetBrains Mono, Satoshi, Manrope, Poppins, DM Sans and their kin. Faces with a reason to be here (period printing for the cabinet's labels, a working text face for reading) are chosen in the mockups.
- **Controls.** No gradient pill buttons, no glow, no identical card grids. Controls are physical where the scene allows (a drawer pull, a lever, a paper tag) and otherwise plain words that are clearly controls. Every control is named in words, reachable by keyboard, and shows focus.
- **Reading.** Any text in the scene can be brought flat and full size. Small type has a floor, and contrast is checked.
- **Access.** Reduced motion, full keyboard use, names for screen readers, and a plain ledger view of everything the 3D scene shows.
- **Iteration.** Every screen is built, screenshotted, critiqued and reworked until it clears Connor's bar before he sees it. No first passes.

## Checked against reality on 2026-11-08

- **The data exists and parses.** One day of Current Events (2025-03-03) gave ten items, each linking its places (Mannheim, Haifa, "Kalat, Balochistan"). The place is usually named in the text, so the skill under test is disambiguation (which Kalat), which suits a gazetteer tool and makes a fair task.
- **Training on this Mac works.** MLX needs native Apple silicon Python; Connor's Anaconda (and its `uv`) is an Intel build running under Rosetta, so Beagle keeps its own native environment. A small network trained one pass over 20,000 examples in 5.1 seconds, and answered in 0.71 ms warm.
- **Claude runs on Connor's plan**, so limits are usage windows, not dollars: runs default to four at once, back off when limited, and a voyage can resume.

## Left to the builder

Population size and number of generations by default (start around 12 genomes, 5 generations), the exact grade curve, the fossil architecture per arena, and the visual details of the cabinet within the direction above.
