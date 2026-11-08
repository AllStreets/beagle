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
  id text primary key,
  voyage text,
  generation integer not null,
  parent_ids text not null,      -- json array
  body text not null,            -- json: the genome
  reason text                    -- why the designer made it
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
  kind text not null,            -- race, design, baseline, teach
  model text not null,
  usd real not null,
  ms integer not null
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
  db.exec(SCHEMA);
  return db;
}

export function close() { db?.close(); db = null; }

export const json = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };
