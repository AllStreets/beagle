import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.ts';
import { open } from './store.ts';
import * as ledger from './ledger.ts';
import { startVoyage, race, getVoyage, finishVoyage, sealedScore, type RaceEvent, type RaceResult } from './race.ts';
import { exportBundle, regrade } from './bundle.ts';
import { starters } from './arenas/geotag/starters.ts';
import { getSettings, saveSettings } from './settings.ts';
import { breed } from './designer.ts';
import { teach, fossilise } from './fossil.ts';
import type { Genome } from './genome.ts';

const [cmd, ...args] = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };

function table(r: RaceResult) {
  const names = new Map((open().prepare('select id, body from genomes').all() as { id: string; body: string }[]).map(g => [g.id, (JSON.parse(g.body) as Genome).name]));
  console.log(`\n${r.complete ? 'Complete' : `Incomplete: ${r.reason}`}. ${r.common.length} tasks every entrant finished.\n`);
  console.log('  score  95% interval    cost     time  front  answered  entrant');
  for (const s of r.scores) console.log(`  ${(s.mean * 100).toFixed(1).padStart(5)}  ${(s.lo * 100).toFixed(1).padStart(5)} to ${(s.hi * 100).toFixed(1).padEnd(5)}  $${s.usd.toFixed(3).padStart(6)}  ${(s.ms / 1000).toFixed(1).padStart(5)}s  ${String(s.pareto).padStart(5)}  ${String(s.tasks - s.noAnswer).padStart(4)}/${s.tasks}  ${names.get(s.genome) ?? s.genome}`);
}
const progress = (e: RaceEvent) => {
  if (e.type === 'progress' && (e.done % 25 === 0 || e.done === e.total)) console.log(`  ${e.done} of ${e.total} runs, $${e.spent.toFixed(2)} spent`);
  if (e.type === 'waiting') console.log(`  usage limit: waiting until ${e.until.slice(11, 19)}`);
};

const commands: Record<string, () => Promise<void> | void> = {
  async arena() {
    if (args[0] !== 'build' || args[1] !== 'geotag') return console.log('beagle arena build geotag');
    if (!existsSync(join(paths.arenas, 'gazetteer.db'))) await import('../scripts/fetch-geonames.ts');
    await import('../scripts/build-geotag.ts');
  },
  voyage() {
    if (args[0] !== 'start') return console.log('beagle voyage start geotag [--race-tasks 100]');
    const v = startVoyage(args[1] ?? 'geotag', flag('race-tasks') ? { raceTasks: Number(flag('race-tasks')) } : {});
    console.log(`Voyage ${v.id} on ${v.arena}.\nSealed test fingerprint, recorded before anything ran: ${v.sealed_hash}`);
  },
  async race() {
    const v = getVoyage(args[0]); const gen = Number(flag('generation') ?? 0);
    console.log(`Racing generation ${gen} of ${v.id}: ${starters().length} starters and the baselines on ${v.settings.raceTasks} tasks, cap $${v.settings.capGeneration}.`);
    table(await race(v.id, gen, starters(), { onEvent: progress }));
  },
  // breed and race generation after generation, from the last one raced
  async evolve() {
    const v = getVoyage(args[0]), db = open(), n = Number(flag('generations') ?? 1);
    for (let i = 0; i < n; i++) {
      const last = (db.prepare('select max(generation) g from runs where voyage = ? and generation >= 0').get(v.id) as { g: number }).g;
      console.log(`\nGeneration ${last + 2}: the designer reads generation ${last + 1}...`);
      const b = await breed(v.id, last, { children: Number(flag('children') ?? 8), elites: 2, probe: 6, log: console.log });
      for (const r of b.refused) console.log(`  refused "${r.name}": ${r.why}`);
      for (const g of b.next.slice(2)) console.log(`  + ${g.name} (from ${b.parents[g.id].join(', ')}): ${b.reasons[g.id]}`);
      const r = await race(v.id, last + 1, b.next, { onEvent: progress });
      table(r);
      if (!r.complete) break;
    }
  },
  async teach() {
    const r = await teach(args[0], args[1], { limit: Number(flag('limit') ?? 800), capUsd: Number(flag('cap') ?? 4.5), log: console.log });
    console.log(`${r.taught} pool items taught by ${args[1]}; $${r.spent.toFixed(2)} this run.`);
  },
  async fossilise() {
    const r = await fossilise(args[0], args[1], { withBreeding: args.includes('--with-breeding'), log: console.log });
    console.log(`Fossil of ${args[1]}: ${r.race.items} race items, score ${Math.round(r.race.score * 100)} against its teacher's ${Math.round(r.race.teacher * 100)}; agrees with it on ${Math.round(r.race.agreement * 100)}%. ${r.bytes} bytes; ${r.ms_per_answer.toFixed(2)} ms per answer plus ${r.embed_ms} ms to embed. ${r.race.standsIn ? 'It stands in for its teacher.' : 'It does not stand in: more than 5 points behind.'}`);
  },
  // stop whatever process is racing this voyage, by the lock it holds, whatever it is called
  stop() {
    const locks = open().prepare('select generation, pid from locks where voyage = ?').all(args[0]) as { generation: number; pid: number }[];
    if (!locks.length) return console.log(`Nothing is racing ${args[0]}.`);
    for (const l of locks) { try { process.kill(l.pid, 'SIGTERM'); console.log(`Stopped process ${l.pid}, racing generation ${l.generation + 1}.`); } catch { console.log(`Process ${l.pid} had already ended.`); } }
  },
  // a voyage that cannot stand is kept on record, marked, with the reason
  withdraw() { commands.stop(); open().prepare(`update voyages set status = 'withdrawn', note = ? where id = ?`).run(args.slice(1).join(' '), args[0]); console.log(`Voyage ${args[0]} withdrawn.`); },
  finish() { finishVoyage(args[0]); console.log(`Voyage ${args[0]} finished. Its sealed test can now be scored.`); },
  async sealed() { table(await sealedScore(args[0], args.slice(1), { onEvent: progress })); },
  export() { console.log(exportBundle(args[0])); },
  regrade() {
    const r = regrade(args[0], flag('generation') ? Number(flag('generation')) : undefined);
    console.log(`Generation ${r.generation} re-graded from the bundle alone. ${r.mismatches ? `${r.mismatches} recorded scores did NOT match.` : 'Every recorded score matched.'}`);
    table(r);
  },
  status() {
    const v = getVoyage(args[0]), db = open();
    const gens = db.prepare('select generation, count(*) n from runs where voyage = ? group by generation').all(v.id) as { generation: number; n: number }[];
    console.log(`${v.id} (${v.status}) on ${v.arena}, started ${v.started_at}\nSealed fingerprint: ${v.sealed_hash}\nSpent $${ledger.spent(v.id).toFixed(2)} of $${v.settings.capVoyage}\n${gens.map(g => `Generation ${g.generation}: ${g.n} runs`).join('\n')}`);
  },
  settings() {
    if (args[0] === 'set') console.log(saveSettings({ [args[1]]: JSON.parse(args[2]) }));
    else console.log(getSettings());
  },
  help() {
    console.log(`beagle <command>

  arena build geotag          build the geotagging arena from Wikipedia and GeoNames
  voyage start geotag         start a voyage; prints the sealed test's fingerprint
  race <voyage>               race the starters and baselines (generation 0)
  status <voyage>             what has run and what it cost
  export <voyage>             write the voyage as a bundle anyone can re-grade
  regrade <bundle>            re-score a bundle from its answers alone, no model calls
  finish <voyage>             close a voyage so its sealed test can be scored
  sealed <voyage> <genome...> score genomes on the sealed test
  settings [set <key> <json>] show or change settings`);
  },
};
await (commands[cmd ?? 'help'] ?? commands.help)();
