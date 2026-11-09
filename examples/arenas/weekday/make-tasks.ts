// Writes tasks.jsonl: 400 dates from 1600 to 2200, each written out in words, with its weekday.
// The dates are drawn by a fixed seed, so the file is the same every time it is made.
import { writeFileSync } from 'node:fs';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ORD = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
const lines: string[] = [], seen = new Set<string>();
for (let i = 0; lines.length < 400; i++) {
  const ms = Date.UTC(1600, 0, 1) + Math.floor(r() * (Date.UTC(2200, 11, 31) - Date.UTC(1600, 0, 1)) / 864e5) * 864e5, d = new Date(ms);
  if (seen.has(d.toISOString())) continue; seen.add(d.toISOString());
  const text = i % 2 ? `the ${ORD(d.getUTCDate())} of ${MONTHS[d.getUTCMonth()]}, ${d.getUTCFullYear()}` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  lines.push(JSON.stringify({ id: d.toISOString().slice(0, 10), input: text, truth: { day: DAYS[d.getUTCDay()] } }));
}
writeFileSync(new URL('./tasks.jsonl', import.meta.url), lines.join('\n') + '\n');
console.log(`${lines.length} tasks written`);
