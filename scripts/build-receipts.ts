// Builds the receipts arena from CORD v2 (naver-clova-ix/cord-v2, CC BY 4.0): ground truth only,
// no images, read by fetch-cord.py and cached. train -> breeding, validation -> race, test -> sealed.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { paths } from '../src/paths.ts';
import { open } from '../src/store.ts';
import { truthOf, textOf } from '../src/arenas/receipts/grade.ts';

const SPLITS: [string, string][] = [['train', 'breeding'], ['validation', 'race'], ['test', 'sealed']];
const cache = join(paths.cache, 'cord-v2.json'); mkdirSync(paths.cache, { recursive: true });
if (!existsSync(cache)) execFileSync(join(import.meta.dirname, '..', 'trainer', '.venv', 'bin', 'python'), [join(import.meta.dirname, 'fetch-cord.py'), cache], { stdio: ['ignore', 'inherit', 'inherit'] });
const cord = JSON.parse(readFileSync(cache, 'utf8')) as Record<string, string[]>;
const db = open(), put = db.prepare('insert or replace into tasks (id, arena, split, input, truth, meta) values (?, ?, ?, ?, ?, ?)');
const rows: string[] = [];
db.exec('begin'); db.prepare(`delete from tasks where arena = 'receipts'`).run();
for (const [hf, split] of SPLITS) {
  let kept = 0;
  cord[hf].forEach((raw, i) => {
    const gt = JSON.parse(raw), truth = truthOf(gt), text = textOf(gt);
    if (!truth.total && !truth.items.length) return;   // nothing to grade
    const id = `receipts:${hf}-${i}`;
    put.run(id, 'receipts', split, JSON.stringify({ text }), JSON.stringify(truth), JSON.stringify({ source: 'CORD v2', split: hf, row: i }));
    rows.push(`${id}|${text}|${JSON.stringify(truth)}`); kept++;
  });
  console.log(`  ${split}: ${kept} receipts from CORD ${hf}`);
}
db.prepare('insert or replace into arenas (id, name, version, hash, built_at) values (?, ?, ?, ?, ?)').run('receipts', 'Read the receipt', 'CORD v2; train to learn from, validation to race, test sealed', createHash('sha256').update(rows.join('\n')).digest('hex'), new Date().toISOString());
db.exec('commit');
console.log('Receipts arena built.');
