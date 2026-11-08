import { DatabaseSync } from 'node:sqlite';
import { paths, ensureDirs } from './paths.ts';

let db: DatabaseSync | null = null;

const SCHEMA = `
create table if not exists arenas (
  id text primary key,
  name text not null,
  version text not null,
  hash text not null,            -- fingerprint of every task, so a changed arena is noticed
  built_at text not null
);
create table if not exists tasks (
  id text primary key,
  arena text not null,
  split text not null,           -- breeding, race, sealed or pool
  input text not null,           -- json
  truth text,                    -- json; null for the unlabelled pool
  meta text                      -- json: date, source, anything a person would want to check
);
create index if not exists tasks_split on tasks(arena, split);
create table if not exists voyages (
  id text primary key,
  arena text not null,
  started_at text not null,
  sealed_hash text not null,     -- recorded before generation zero runs
  settings text not null,        -- json
  status text not null           -- racing, paused, finished
);
create table if not exists genomes (
  id text not null,              -- the genome's own id; the same starter can sail in many voyages
  voyage text,
  generation integer not null,
  parent_ids text not null,      -- json array
  body text not null,            -- json: the genome
  reason text,                   -- why the designer made it
  primary key (voyage, id)
);
create table if not exists runs (
  id text primary key,
  voyage text not null,
  generation integer not null,
  genome text not null,
  task text not null,
  answer text,                   -- json
  score real,
  trace text not null,           -- json: every model turn and tool call
  usd real not null,
  ms integer not null,
  status text not null,          -- done or no-answer
  at text not null
);
create index if not exists runs_by on runs(voyage, generation, genome);
create unique index if not exists runs_once on runs(voyage, generation, genome, task);
create table if not exists ledger (
  id integer primary key autoincrement,
  at text not null,
  voyage text,
  generation integer,            -- which generation paid for it
  kind text not null,            -- race, design, baseline, teach
  model text not null,
  usd real not null,
  ms integer not null
);
-- a race in progress, so a second process cannot race the same generation and pay twice
create table if not exists locks (
  voyage text not null,
  generation integer not null,
  pid integer not null,
  at text not null,
  primary key (voyage, generation)
);
create table if not exists settings (
  key text primary key,
  value text not null            -- json
);
`;

export function open(): DatabaseSync {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(paths.db);
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 5000;');
  // before 2026-11-08 genomes were keyed by id alone, so a second voyage lost its starters
  const pk = (db.prepare(`select sql from sqlite_master where name = 'genomes'`).get() as { sql: string } | undefined)?.sql ?? '';
  if (pk && !pk.includes('primary key (voyage, id)')) db.exec(`alter table genomes rename to genomes_old;`);
  db.exec(SCHEMA);
  try { db.exec('alter table ledger add column generation integer'); } catch { /* already there */ }
  if (pk && !pk.includes('primary key (voyage, id)')) db.exec(`insert or ignore into genomes select id, voyage, generation, parent_ids, body, reason from genomes_old; drop table genomes_old;`);
  return db;
}

export function close() { db?.close(); db = null; }

export const json = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };
