# Beagle Phase 4 Implementation Plan

**Goal:** the other two arenas (fixing a failing test, extracting fields from receipts) and arenas anyone can define, raced for real and shown in the ship.

**Spec:** docs/specs/2026-11-08-beagle-design.md (The arenas; Phases, item 4).

## Global Constraints

- Every arena is a task type with a grader and breeding, race and sealed splits; the sealed split is fingerprinted at launch.
- Caps hold: $5 a generation, $25 a voyage. Controls race beside the agents on every arena.
- The designer composes from existing tools; it never writes tool code.
- Fix-test: single mutations of a small, well-tested open-source library; ground truth is its test suite; agents work in APFS clones and may not touch the tests. No fossil.
- Receipts: a public labelled dataset (CORD v2, CC BY 4.0); fields graded by exact and fuzzy match.
- Your own arena: a folder with `tasks.jsonl` and `grade.ts`; Beagle splits it.
- No emojis, no em dashes, no AI look. Every number on screen comes from the API.

## Tasks

1. **The engine stops assuming geotagging.** `Arena` gains `valid(answer)`, `merge(answers)` (votes), `example(truth)` (worked examples), `miss(answer, truth)` (what the designer reads), `maxTurns`, `starters()`, `baselines()`, and `grade` may be async. Runner, race, designer, bundle and server use them. Test: a toy arena runs through race and designer with no geotag code.
2. **Your own arena.** `beagle arena add <folder>` reads `arena.json`, `tasks.jsonl` and `grade.ts`, splits by a hash of each task (60 breeding, 25 race, 15 sealed), and registers it. An example folder ships in `examples/arenas/weekday`. Test: a folder becomes an arena whose voyage races.
3. **Receipts.** Build from CORD v2 through the Hugging Face datasets server (ground truth only). Input: the receipt's text lines; answer: total, subtotal, tax and items. Grader: numbers exact after normalising, item names fuzzy. Controls: the largest number, the number after TOTAL, one Claude call. Tests: grader cases, parser cases.
4. **Fix the failing test.** Vendor more-itertools (MIT, stdlib unittest). Generate single-line mutants that fail between 1 and 8 tests; split by function so no function crosses splits. Tools: list_files, read_file, search, run_tests (edits applied in an APFS clone). Answer: find-and-replace edits. Grade: edits applied in a fresh clone; 0 if a test file is touched or a find does not match once; otherwise the share of the mutant's failing tests now passing, and 0 if any passing test breaks. Controls: no change, one Claude call. Tests: mutant, grade, sandbox cases.
5. **Race them.** One voyage each: generation one, then one bred generation where the cap allows.
6. **The ship shows every arena.** A voyage chooser; arena-aware rooms: the chart room becomes the receipt desk or the test bench for those arenas; the log's in-browser re-grade covers any arena whose grader runs in a browser, and says so when it cannot.
7. **README, tests, merge.**

## Review Focus

- A grader that throws on a malformed answer must score 0, not crash a race.
- A fix-test edit outside the package, or to a test file, scores 0 and never touches the vendored source.
- Two runs grading at once must not share a clone.
- A custom `grade.ts` that never returns must not hang a race forever.
- Sealed tasks of a custom arena must never reach the designer or the API.
