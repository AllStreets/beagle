// Everything the app shows comes from the local API. Nothing here is invented.
export type Score = { genome: string; mean: number; lo: number; hi: number; usd: number; ms: number; pareto: number; tasks: number; noAnswer: number; within: number };
export type Genome = { id: string; name: string; model: string; instructions: string; tools: string[]; workflow: { shape: string; n?: number }; memory: { examples: number } };
export type Generation = { voyage: string; generation: number; genomes: { id: string; name: string; model: string; genome: Genome; reason: string | null; parents: string[] }[]; scores: Score[]; common: number; runs: number; expected: number; racing: boolean };
export type Voyage = { id: string; arena: string; started_at: string; sealed_hash: string; status: string; spent: number; time: number; racing: boolean; settings: { capGeneration: number; capVoyage: number; raceTasks: number; seed: number; view: 'plain' | 'lab' }; generations: { generation: number; runs: number; usd: number }[] };
export type Telling = { task: { id: string; input: { text: string; hidden: string; date: string }; truth: { places: { name: string; lat: number; lon: number }[] }; shown: string }; answers: { run: string; genome: string; name: string; control: boolean; answer: { lat: number; lon: number } | null; score: number; status: string }[] };
export type Arena = { id: string; name: string; describe: string; counts: Record<string, number>; info: { hash: string; version: string; built_at: string } | null; tasks: unknown[] };

export const api = <T>(p: string, fallback?: T): Promise<T> => fetch(`/api${p}`).then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${p}`))).catch(e => { if (fallback !== undefined) return fallback; throw e; }) as Promise<T>;
export const post = (p: string, body?: unknown) => fetch(`/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-beagle': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });

export type Entrant = Score & { name: string; control: boolean; body?: Genome };
export function entrants(g: Generation): Entrant[] {
  const by = new Map(g.genomes.map(x => [x.id, x]));
  return g.scores.map(s => ({ ...s, name: by.get(s.genome)?.name ?? s.genome.replace('baseline:', ''), control: s.genome.startsWith('baseline:'), body: by.get(s.genome)?.genome }));
}
export const pct = (x: number) => Math.round(x * 100);
