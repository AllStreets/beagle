#!/usr/bin/env node
// Runs the TypeScript CLI directly; Node's built-in SQLite does the storage.
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
process.removeAllListeners('warning');
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
register();
await import(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts'));
