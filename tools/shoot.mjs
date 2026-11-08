// Screenshot a page from this repo the way a reviewer would see it.
//   node tools/shoot.mjs <file-or-url> <out.png> [--w 1440 --h 900 --click x,y --wait 3000 --dpr 2]
// Local files are served over http so WebGL can read their images.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, dirname, basename, join } from 'node:path';

const [target, out, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : d; };
const all = k => rest.flatMap((v, i) => rest[i - 1] === '--' + k ? [v] : []);
const W = +opt('w', 1440), H = +opt('h', 900), wait = +opt('wait', 3000), dpr = +opt('dpr', 2);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
let url = target, server;
if (!/^https?:/.test(target)) {
  const root = dirname(resolve(target));
  server = createServer(async (req, res) => {
    try { const p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)); res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(await readFile(p)); }
    catch { res.writeHead(404); res.end(); }
  }).listen(0);
  url = `http://127.0.0.1:${server.address().port}/${basename(target)}`;
}

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
page.on('pageerror', e => console.error('page error:', e.message));
page.on('console', m => m.type() === 'error' && console.error('console:', m.text()));
await page.goto(url);
await page.waitForTimeout(wait);
for (const js of all('js')) { await page.evaluate(js); await page.waitForTimeout(+opt('after', 2500)); }
for (const c of all('click')) { const [x, y] = c.split(',').map(Number); await page.mouse.click(x, y); await page.waitForTimeout(1400); }
await page.screenshot({ path: out });
await browser.close(); server?.close();
console.log(out);
