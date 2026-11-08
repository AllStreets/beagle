// Pull a voyage's real numbers from the local API into design/mockups/data.json, so the cabinet
// concepts are drawn from a real race, not invented figures.   node tools/snapshot.mjs <voyage>
import { writeFileSync } from 'node:fs';
const API = 'http://127.0.0.1:4750/api', V = process.argv[2];
const get = p => fetch(API + p).then(r => r.json());
const v = await get(`/voyages/${V}`), gen = await get(`/voyages/${V}/generations/0`), arena = await get(`/arenas/${v.arena}/sample`);
const byId = new Map(gen.genomes.map(g => [g.id, g]));
const entrants = [];
for (const s of gen.scores) {
  const g = byId.get(s.genome);
  entrants.push({ ...s, name: g?.name ?? s.genome.replace('baseline:', ''), kind: g ? 'genome' : 'baseline', model: g?.model ?? (s.genome.includes('Claude') ? 'claude:claude-haiku-4-5' : 'none'),
    shape: g?.genome.workflow.shape ?? 'baseline', n: g?.genome.workflow.n ?? null, tools: g?.genome.tools ?? [], examples: g?.genome.memory.examples ?? 0,
    within25: s.within, ran: s.tasks });
}
const leader = entrants.find(e => e.kind === 'genome');
const leaderRuns = await get(`/voyages/${V}/runs?generation=0&genome=${encodeURIComponent(leader.genome)}`);
const pick = leaderRuns.find(r => r.score > .4 && r.score < 1) ?? leaderRuns[0];
const run = await get(`/runs/${pick.id}`);
writeFileSync('design/mockups/data.json', JSON.stringify({
  voyage: { id: v.id, sealed_hash: v.sealed_hash, spent: v.spent, cap: v.settings.capVoyage, capGeneration: v.settings.capGeneration, started_at: v.started_at, raceTasks: v.settings.raceTasks },
  arena: { name: arena.name, counts: arena.counts, describe: arena.describe },
  generation: 0, runs: gen.runs, expected: gen.expected, common: gen.common,
  entrants, microscope: { genome: byId.get(leader.genome)?.genome, run: { task: run.task.input, shown: run.task.input.hidden, answer: run.answer, truth: run.task.truth, score: run.score, trace: run.trace, usd: run.usd, ms: run.ms } },
}, null, 1));
console.log(`${entrants.length} entrants, ${gen.runs} of ${gen.expected} runs, leader ${leader.name} at ${Math.round(leader.mean * 100)}`);

// one task every entrant answered, with every answer, for the chart
const counts = new Map();
const perEntrant = {};
for (const e of entrants) { const rs = await get(`/voyages/${V}/runs?generation=0&genome=${encodeURIComponent(e.genome)}`); perEntrant[e.genome] = rs; for (const r of rs) counts.set(r.task, (counts.get(r.task) ?? 0) + 1); }
const shared = [...counts].filter(([, n]) => n === entrants.length).map(([t]) => t);
// the most telling task: the one where scores spread the most
let best = null, spread = -1;
for (const t of shared) { const sc = entrants.map(e => perEntrant[e.genome].find(r => r.task === t).score); const sp = Math.max(...sc) - Math.min(...sc); if (sp > spread) { spread = sp; best = t; } }
if (best) {
  const answers = [];
  for (const e of entrants) { const r = perEntrant[e.genome].find(x => x.task === best); const full = await get(`/runs/${r.id}`); answers.push({ genome: e.genome, name: e.name, kind: e.kind, answer: full.answer, score: full.score, status: full.status }); if (!globalThis.taskFull) globalThis.taskFull = full.task; }
  const d = JSON.parse((await import('node:fs')).readFileSync('design/mockups/data.json', 'utf8'));
  d.chart = { task: globalThis.taskFull, answers };
  writeFileSync('design/mockups/data.json', JSON.stringify(d, null, 1));
  console.log(`chart task: ${globalThis.taskFull.input.hidden.slice(0, 90)}  (truth ${globalThis.taskFull.truth.places.map(p => p.name).join(', ')})`);
}
