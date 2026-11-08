# Beagle Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One arena (headline geotagging) built from real data, generation zero raced live against baselines under a spend cap, with every score provable, shown in a cabinet Connor chose.

**Architecture:** A TypeScript engine on Node 22 keeps everything in `node:sqlite`. Models are driven through one interface: Claude through a lean headless `claude -p` call, Ollama through its HTTP API. Beagle runs its own tool loop, so traces and costs are its own. A local HTTP API feeds a three.js cabinet. Phases 2 to 4 (breeding, fossils, more arenas, the Tauri app) get their own plans.

**Tech Stack:** TypeScript, Node 22.13+, `node:sqlite`, tsx, node:test, Playwright, three.js, Vite. Data: Wikipedia Current Events (CC BY-SA), Wikidata (CC0), GeoNames (CC BY).

**Spec:** `docs/specs/2026-11-08-beagle-design.md`

## Global Constraints

- Spend caps: $5 per generation, $25 per voyage, in Claude Code's reported `total_cost_usd`; local calls count as $0 with their time recorded.
- Runs at once: 4 by default; back off when limited; a voyage can resume.
- The sealed test set's content hash is recorded before generation zero, and the designer and every prompt never see sealed tasks.
- Grade: 1 within 25 km, falling smoothly to 0 at 2,500 km.
- Nothing invented for display: an unmeasured value reads "not measured".
- Outbound requests use the user agent `beagle/0.1 (https://github.com/AllStreets/beagle)` and never carry personal details.
- Claude calls: no settings, plugins, MCP, tools or session saving (`--setting-sources '' --strict-mcp-config --disable-slash-commands --tools '' --no-session-persistence`), stream-json in and out.
- Banned faces: Inter, Geist, Space Grotesk, IBM Plex (all), JetBrains Mono, Satoshi, Manrope, Poppins, DM Sans. No gradient pill buttons, no glow, no identical card grids.
- Every UI surface is screenshotted, critiqued and reworked before Connor sees it.
- Data lives in `~/Library/Application Support/Beagle`, overridable with `BEAGLE_HOME`.

## Review Focus

- A usage limit hit in the middle of a race: those tasks are retried after a back-off, never scored as zero, and the race resumes where it stopped (test in Task 7).
- A model that answers in the wrong shape, loops on tools, or never answers: that task scores 0 with the reason "no answer" in its trace, and nothing crashes (test in Task 6).
- The spend cap is reached mid-generation: the generation is marked incomplete, and genomes are compared only on the tasks they all finished, so none is unfairly penalised (test in Task 7).
- A headline whose places are not in the gazetteer, or a name with many matches: the gazetteer returns an empty or ranked list, and the agent still answers (test in Task 3).
- Wikipedia or Wikidata rate-limiting or failing while the arena is built: every fetch is cached, so re-running continues where it left off (test in Task 4).

---

### Task 1: Project, storage and money

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/paths.ts`, `src/store.ts`, `src/ledger.ts`
- Test: `test/store.test.ts`

**Interfaces:**
- Produces: `paths: { home, db, arenas, cache, bundles }`, `ensureDirs()`, `open(): DatabaseSync`, `json<T>(s, fallback): T`; `ledger.add(entry: { voyage: string | null; kind: 'race' | 'design' | 'baseline' | 'teach'; model: string; usd: number; ms: number })`, `ledger.spent(voyage: string, since?: string): number`.
- Schema: `arenas(id, name, version, hash, built_at)`, `tasks(id, arena, split, input, truth, meta)` (split: breeding, race, sealed, pool), `voyages(id, arena, started_at, sealed_hash, settings, status)`, `genomes(id, voyage, generation, parent_ids, body, reason)`, `runs(id, voyage, genome, task, answer, score, trace, usd, ms, status)` (status: done, no-answer, retry), `ledger(...)`, `settings(key, value)`.

- [ ] **Step 1:** Test: `ledger.spent` sums only one voyage's entries; local entries add 0 dollars but keep time; `open()` with a temporary `BEAGLE_HOME` creates the schema.
- [ ] **Step 2:** Run `npm test` and see it fail.
- [ ] **Step 3:** Implement, copying Understudy's store pattern (`node:sqlite`, WAL, idempotent schema).
- [ ] **Step 4:** Run `npm test`: PASS.
- [ ] **Step 5:** Commit `feat: storage and the spend ledger`.

### Task 2: Models

**Files:**
- Create: `src/models/claude.ts`, `src/models/ollama.ts`, `src/models/index.ts`
- Test: `test/models.test.ts`

**Interfaces:**
- Produces: `type Turn = { role: 'system' | 'user' | 'assistant'; content: string }`; `complete(model: string, turns: Turn[], o?: { schema?: object; timeoutMs?: number }): Promise<{ text: string; json?: unknown; usd: number; ms: number }>`. The model id is `claude:<name>` or `ollama:<name>`. A usage-limit failure throws `LimitError`. `setDriver(fn)` replaces the real call in tests.

- [ ] **Step 1:** Test with `setDriver`: routes by prefix; a `LimitError` passes through untouched; an Ollama call records `usd: 0`.
- [ ] **Step 2:** Run and see it fail.
- [ ] **Step 3:** Claude: port Understudy's `src/claude.ts` (flags in Global Constraints), mapping turns to one stream-json message, with the schema passed as `--json-schema`; detect usage-limit messages in the result as `LimitError`. Ollama: `POST /api/chat` with `format` set to the schema.
- [ ] **Step 4:** PASS, plus one live smoke call each (`claude:claude-haiku-4-5`, `ollama:qwen3:1.7b`), recorded in the commit message.
- [ ] **Step 5:** Commit `feat: one interface for Claude and local models`.

### Task 3: The gazetteer

**Files:**
- Create: `src/arenas/geotag/gazetteer.ts`, `scripts/fetch-geonames.ts`
- Test: `test/gazetteer.test.ts`, `test/fixtures/geonames-small.tsv`

**Interfaces:**
- Produces: `buildGazetteer(srcDir: string): void` (GeoNames `cities1000`, `admin1CodesASCII`, `countryInfo` into an FTS5 table); `lookup(name: string, o?: { country?: string; limit?: number }): Place[]` with `Place = { name: string; admin1: string; country: string; lat: number; lon: number; population: number; kind: 'city' | 'admin1' | 'country' }`, ranked by exact name, then population.

- [ ] **Step 1:** Tests on the fixture: `lookup('Kalat')` returns both the Pakistani and the Afghan Kalat, Pakistan's first if it is larger; `lookup('Kalat', { country: 'AF' })` returns only Afghanistan's; `lookup('Nowhereville')` returns `[]`; accents match plainly (`Güímar` = `Guimar`).
- [ ] **Step 2:** Fail.
- [ ] **Step 3:** Implement. The fetch script downloads from `download.geonames.org/export/dump/` into `paths.cache`.
- [ ] **Step 4:** PASS. Build the real gazetteer and run it on 10 place names from the 2025-03-03 page; note the hit rate in the commit.
- [ ] **Step 5:** Commit `feat: offline gazetteer`.

### Task 4: The geotagging arena

**Files:**
- Create: `src/arenas/geotag/build.ts`, `src/arenas/geotag/parse.ts`, `src/arenas/geotag/grade.ts`, `src/arenas/types.ts`
- Test: `test/geotag.test.ts`, `test/fixtures/current-events-2025-03-03.wikitext`

**Interfaces:**
- Produces: `type Arena = { id: string; describe: string; grade(answer: unknown, truth: unknown): number; tools: ToolSpec[] }`; `parseDay(wikitext: string): { text: string; links: string[] }[]`, with link markup stripped to plain text and the citation links removed; `grade({ lat, lon }, truth: { places: { lat: number; lon: number }[] }): number` scored against the nearest true place; `buildGeotag(o: { from: string; to: string; sealedFrom: string }): Promise<{ counts: Record<string, number>; hash: string }>`.
- Splits by date: breeding = the earliest 60% of labelled days, race = the next 20%, sealed = from `sealedFrom` on; the pool = days outside the labelled range, minus any item whose text or place set matches a sealed item. The truth places are an item's linked articles that have Wikidata coordinates (P625) and are places (city, settlement, region, country), most specific first. Items with none are dropped.

- [ ] **Step 1:** Tests: `parseDay` on the fixture gives at least 8 items and the Mannheim item's text reads "A car drives into a crowd of people near a Carnival market in Mannheim, Germany, killing two people and injuring 25 others, including fifteen seriously. A man has been arrested." with no brackets or sources; `grade` is 1 at 25 km, 0.5 at 250 km, 0 at 2,500 km and beyond (curve: `1 - ln(km / 25) / ln(100)`, clamped); the pool never shares a text with sealed; a second build with a warm cache makes no network calls (fetch stubbed to throw).
- [ ] **Step 2:** Fail.
- [ ] **Step 3:** Implement, fetching through the MediaWiki and Wikidata APIs with the Global user agent, with every response cached on disk by URL and at most 2 requests a second.
- [ ] **Step 4:** PASS. Build the real arena: labelled 2023-01-01 to 2025-06-30, sealed from 2025-04-01, pool 2019 to 2022. Record the counts and hash in the commit.
- [ ] **Step 5:** Commit `feat: the geotagging arena from Wikipedia Current Events`.

### Task 5: Genomes

**Files:**
- Create: `src/genome.ts`, `src/arenas/geotag/starters.ts`
- Test: `test/genome.test.ts`

**Interfaces:**
- Produces: `type Genome = { id: string; name: string; model: string; instructions: string; tools: string[]; workflow: { shape: 'single' | 'plan-then-answer' | 'self-check' | 'vote'; n?: number }; memory: { examples: number } }`; `validate(g: unknown): Genome` (throws, saying what is wrong); `starters(): Genome[]`, 12 varied designs across models (`claude:claude-haiku-4-5`, `claude:claude-sonnet-5`, `ollama:qwen3:1.7b`, `ollama:llama3.1:8b`), all four shapes, with and without the gazetteer, 0 to 4 examples.

- [ ] **Step 1:** Tests: every starter validates; a genome naming an unknown tool, a `vote` without `n`, or `n > 7` is rejected with a reason.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: genomes and twelve starters`.

### Task 6: The runner

**Files:**
- Create: `src/runner.ts`
- Test: `test/runner.test.ts`

**Interfaces:**
- Consumes: `complete` (Task 2), `Arena` and its tools (Task 4), `Genome` (Task 5).
- Produces: `run(g: Genome, task: { id: string; input: unknown }, arena: Arena, o?: { examples?: { input: unknown; truth: unknown }[] }): Promise<{ answer: unknown | null; trace: Step[]; usd: number; ms: number; status: 'done' | 'no-answer' }>`, with `Step = { kind: 'model' | 'tool'; input: unknown; output: unknown; usd: number; ms: number }`. Each turn the model returns `{ tool, args }` or `{ answer }` under a schema; at most 6 turns. `vote` runs the inner shape `n` times and takes the geometric median.

- [ ] **Step 1:** Tests with a stub driver: a tool request is executed and its result fed back; malformed output twice gives `no-answer`, not a throw; 6 tool calls without an answer gives `no-answer`; `vote` of three answers returns their median; costs sum over steps.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: Beagle's own tool loop`.

### Task 7: Races, baselines and proof

**Files:**
- Create: `src/race.ts`, `src/baselines.ts`, `src/stats.ts`, `src/bundle.ts`, `src/cli.ts`, `bin/beagle.mjs`
- Test: `test/race.test.ts`, `test/bundle.test.ts`

**Interfaces:**
- Produces: `startVoyage(arenaId: string, o?: Partial<Settings>): Voyage`, which records `sealed_hash` before anything runs; `race(voyageId: string, generation: number, genomes: Genome[], onProgress?: (e: RaceEvent) => void): Promise<RaceResult>`; `RaceResult = { complete: boolean; common: string[]; scores: { genome: string; mean: number; lo: number; hi: number; usd: number; ms: number; pareto: number }[] }`; `baselines(arenaId): Baseline[]` with `Baseline = { name: 'random point' | 'gazetteer alone' | 'starter' | 'one Claude call'; answer(task): Promise<{ answer: unknown | null; usd: number; ms: number }> }`, raced on the same tasks and stored as runs under genome ids `baseline:<name>`; a genome's worked examples are `memory.examples` items drawn from the breeding split with the voyage's seed, the same for every genome of a generation; `bootstrap(xs: number[], seed: number): { lo: number; hi: number }` (10,000 resamples, 95%); `exportBundle(voyageId): string`; `regrade(bundlePath): RaceResult` (no model calls); `sealedScore(voyageId)`, refused until the voyage is finished.
- CLI: `beagle arena build geotag`, `beagle voyage start geotag`, `beagle race <voyage> [--genomes starters]`, `beagle regrade <bundle>`, `beagle status <voyage>`.

- [ ] **Step 1:** Tests with a stub driver: examples come only from the breeding split, never race or sealed; the race stops when `ledger.spent` reaches the cap and returns `complete: false`, with `common` holding only tasks every genome finished, and scores computed on those; a `LimitError` is retried after a back-off and never stored as a score; resuming skips finished runs; `bootstrap` on a fixed seed gives fixed bounds; `regrade(exportBundle(v))` reproduces the race scores exactly; changing one sealed task changes the hash; `sealedScore` before the end throws.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Live: build the arena, start a voyage with population 12 on 100 race tasks, race the starters and baselines under the $5 cap. Record the table in the commit, and a bundle in `.beagle-local/`.
- [ ] **Step 6:** Commit `feat: races, baselines, intervals and re-gradable bundles`.

### Task 8: The local API

**Files:**
- Create: `src/server.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Produces: on `127.0.0.1:4740`: `GET /api/voyages`, `GET /api/voyages/:id` (settings, sealed hash, status, spend), `GET /api/voyages/:id/generations/:n` (genomes, scores, intervals, baselines), `GET /api/runs/:id` (full trace), `GET /api/arenas/:id/sample`, `GET|POST /api/settings`, `POST /api/voyages` and `POST /api/voyages/:id/race`, and a server-sent event stream `GET /api/voyages/:id/events` of `RaceEvent`s. Same guards as Understudy's server: a localhost `Host` only, and the `x-beagle: 1` header required on writes.

- [ ] **Step 1:** Tests: a write without the header is 403; a foreign Host is 403; the event stream emits a run's result after a stubbed race step.
- [ ] **Step 2:** Fail. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: local API and live race events`.

### Task 9: Three cabinet concepts (STOP: Connor chooses)

**Files:**
- Create: `design/mockups/cabinet-a.html`, `cabinet-b.html`, `cabinet-c.html`, `design/shots/*`

- [ ] **Step 1:** Build three distinct cabinet directions in three.js on the live API's real data from Task 7 (real genome names, real scores): each shows the specimen shelf mid-race, one genome under the microscope, and the plain-view sentence. Fonts and materials follow the Global Constraints, and materials are made in code.
- [ ] **Step 2:** Screenshot each at 1440 by 900 plus zoomed crops; critique against the banned list and Connor's no-AI-look notes; rework. At least three rounds each; keep the rounds' shots in `design/shots/` and note what changed.
- [ ] **Step 3:** Show Connor the three, with what each is for. **Stop until he chooses or combines.**
- [ ] **Step 4:** Commit `design: three cabinet concepts`.

### Task 10: The cabinet, Phase 1 surfaces

**Files:**
- Create: `app/` (index, `src/` scene modules split as Understudy's: `kit.ts` room and materials, `cabinet.ts`, `specimens.ts`, `journal.ts` stub, `microscope.ts`, `ledger-view.ts`, `settings.ts`, `main.ts`), `tools/ui-test.ts`, `tools/shoot.mjs`
- Test: `tools/ui-test.ts`

**Interfaces:**
- Consumes: the API (Task 8).

- [ ] **Step 1:** Write the browser acceptance test first: the shelf shows one jar per genome with its real name; starting a race fills jars as events arrive, and each jar's number matches `GET /api/voyages/:id/generations/0`; clicking a jar opens the microscope with the genome and a run whose trace matches `/api/runs/:id`; the plain sentence states the leader's within-25-km count, equal to the API's; lab view shows intervals and the baselines; the sealed hash is visible on the voyage page; hovering "genome", "fitness" or "Pareto" in plain view shows its one-line meaning; Settings saves the caps and they are read back by `GET /api/settings`; the ledger view lists every genome and score as text; no page errors.
- [ ] **Step 2:** Run it and see it fail.
- [ ] **Step 3:** Build the chosen cabinet to pass it.
- [ ] **Step 4:** Screenshot, critique and rework every surface, with at least three rounds, recorded in `design/shots/`.
- [ ] **Step 5:** Test PASS. Commit `feat: the cabinet, Phase 1`.

### Task 11: README and push

**Files:**
- Create: `README.md` (badge block in the style of Connor's other READMEs, media from real runs, the proof section, setup including the native Python note), `LICENSE` (MIT), `docs/media/*`

- [ ] **Step 1:** Write it from measured results only. **Step 2:** Push.
