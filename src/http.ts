// Every outbound request goes through here: one polite user agent with no personal details,
// at most two requests a second, and every answer cached on disk by URL so a build that
// fails halfway picks up where it stopped. Tests stand in a fake with setFetch.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.ts';

export const USER_AGENT = 'beagle/0.1 (https://github.com/AllStreets/beagle)';
type Fetcher = (url: string) => Promise<unknown>;

const real: Fetcher = async url => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { 'user-agent': USER_AGENT, 'accept': 'application/json' } });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && attempt < 5) { await sleep(2000 * 2 ** attempt); continue; }
    throw new Error(`${r.status} from ${new URL(url).host}`);
  }
};
let fetcher: Fetcher = real;
export function setFetch(f: Fetcher | null) { fetcher = f ?? real; }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let last = 0;
async function polite() { const wait = last + 500 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now(); }

export async function cachedJson<T = any>(url: string): Promise<T> {
  const dir = join(paths.cache, 'http'); mkdirSync(dir, { recursive: true });
  const file = join(dir, createHash('sha1').update(url).digest('hex') + '.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  if (fetcher === real) await polite();
  const body = await fetcher(url) as { error?: { code?: string; info?: string } };
  // MediaWiki reports errors (rate limits, lag) as a normal reply: never cache those
  if (body && typeof body === 'object' && body.error) throw new Error(`${new URL(url).host}: ${body.error.code ?? 'error'} ${body.error.info ?? ''}`.trim());
  writeFileSync(file, JSON.stringify(body));
  return body as T;
}
