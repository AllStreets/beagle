import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.ts';
import { open } from './store.ts';
import * as ledger from './ledger.ts';
import { startVoyage, race, getVoyage, finishVoyage, sealedScore, type RaceEvent, type RaceResult } from './race.ts';
import { exportBundle, regrade } from './bundle.ts';
import { starters } from './arenas/geotag/starters.ts';
import { getSettings, saveSettings } from './settings.ts';

const [cmd, ...args] = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };

function table(r: RaceResult) {
  const names = new Map(starters().map(g => [g.id, g.name]));
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
