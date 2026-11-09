// Acceptance test of the app in a real browser against the running server (127.0.0.1:4750).
// It reads the latest voyage and checks that what the screen says matches what the API says.
// Settings it changes are put back.   npx tsx tools/ui-test.ts
import { chromium } from 'playwright';

const URL = process.env.BEAGLE_URL ?? 'http://127.0.0.1:4750/';
const api = (p: string) => fetch(URL + 'api' + p).then(r => r.json());
const results: [string, boolean, string][] = [];
const expect = (name: string, ok: boolean, detail = '') => { results.push([name, ok, detail]); console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const pct = (x: number) => Math.round(x * 100);

const voyages = await api('/voyages'), v = voyages.find((x: any) => x.spent > 0 && x.arena === 'geotag' && x.status !== 'withdrawn') ?? voyages[0];
const full = await api(`/voyages/${v.id}`), genN = full.generations.filter((g: any) => g.generation >= 0).at(-1).generation;
const gen = await api(`/voyages/${v.id}/generations/${genN}`), telling = await api(`/voyages/${v.id}/generations/${genN}/telling`);
const settingsBefore = await api('/settings');
const lead = gen.scores.find((s: any) => !s.genome.startsWith('baseline:')), leadName = gen.genomes.find((g: any) => g.id === lead.genome).name;

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
const go = async (hash: string, wait = 2500) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(wait); };
try {
  await page.goto(URL); await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 60000 }); await page.waitForTimeout(1500);
  const tags = await page.$$eval('.tag', els => els.map(e => e.textContent ?? ''));
  expect('the ship has a tag for each of its six rooms', tags.length === 6, tags.map(t => t.split(/[A-Z]/)[0]).join(''));
  expect('the drawing room tag names the real leader and score', tags.some(t => t.includes(leadName) && t.includes(String(pct(lead.mean)))), `${leadName} ${pct(lead.mean)}`);
  const fossilsNow = await api(`/voyages/${v.id}/fossils`);
  expect('the fossil locker tag tells the truth about its fossils', fossilsNow.length ? tags.some(t => fossilsNow.every((f: any) => t.includes(`${f.name}: ${pct(f.race.score)}`))) : tags.some(t => t.includes('Empty')));
  expect('the log tag shows the real spend', tags.some(t => t.includes(`$${full.spent.toFixed(2)}`)));
  const plaque = await page.textContent('#plaque');
  expect('the plaque gives the real run count', plaque!.includes(`${gen.runs} runs`), plaque!.slice(0, 90));
  // the tags drift with the gallery camera, so this uses keyboard focus, which lights a room the same way
  await page.focus('.tag:nth-child(1)'); await page.waitForTimeout(300);
  expect('focusing a room tag with the keyboard dims the others', (await page.$$('.tag.dim')).length === 5);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());

  await go('#/chart', 4000);
  expect('the chart room opens', (await page.textContent('#folio h1')) === 'The chart room');
  expect('the chart room lists every answer to its item', (await page.$$('#answers tbody tr')).length === telling.answers.length, `${telling.answers.length} answers`);
  const items = await page.$$('.items button');
  expect('the chart room lists the race items', items.length === full.settings.raceTasks || items.length === gen.common, `${items.length}`);
  const cap1 = await page.textContent('#cap');
  await items[0].click(); await page.waitForTimeout(1500);
  expect('choosing another item redraws the chart and its caption', (await page.textContent('#cap')) !== cap1);
  expect('the canvas is drawn', await page.$eval('#chart', (c: any) => c.width > 400));

  await go('#/chart/own', 3000);
  await page.$$eval('input[name=g]', els => els.forEach(e => { (e as HTMLInputElement).checked = (e as HTMLInputElement).value === 'baseline:gazetteer alone'; }));
  await page.fill('textarea[name=text]', 'Floods cut off villages near Mannheim after the Rhine bursts its banks.');
  await page.click('.ask'); await page.waitForFunction(() => /free/.test(document.querySelector('#answers tbody tr')?.textContent ?? ''), null, { timeout: 30000 });
  const own = await page.textContent('#answers tbody tr');
  expect('your own item: a free control answers it live and the answer is listed', !!own && /49\.\d\d, 8\.\d\d/.test(own), own?.replace(/\s+/g, ' ').slice(0, 80));
  const box = (await page.$('#chart'))!; const bb = (await box.boundingBox())!;
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(600);
  expect('marking the truth on the chart grades every answer', /\d+ ?km/.test((await page.textContent('#answers tbody tr')) ?? ''));
  await go('#/specimens');
  const rows = await page.$$eval('.ledger tbody tr', trs => trs.map(t => t.textContent ?? ''));
  expect('the hold lists every specimen', rows.length === gen.scores.length, `${rows.length}`);
  expect('the hold\'s first row has the API\'s top score', rows[0].includes(String(pct(gen.scores[0].mean))));
  await page.waitForFunction(() => /heavier|Too close|same specimen/.test(document.querySelector('#weigh-out')?.textContent ?? ''), null, { timeout: 20000 });
  const common = await page.$eval('.weigh-nums dd', d => Number(d.textContent));
  expect('the scales weigh the first two specimens on every item they share', common === gen.common, `${common} items`);
  const plainCols = (await page.$$('.ledger thead th')).length;
  await page.click('#view'); await page.waitForTimeout(800);
  expect('lab view adds cost, time, rank and answered columns', (await page.$$('.ledger thead th')).length === plainCols + 4);
  await page.click('#view'); await page.waitForTimeout(500);

  await go('#/drawing');
  expect('the drawing room draws every specimen', (await page.$$('.plate canvas')).length === gen.scores.length);
  await page.click('.plate'); await page.waitForTimeout(2000);
  const glass = await page.textContent('#glass');
  expect('a plate opens under the glass with its real score and range', glass!.includes(String(pct(gen.scores[0].mean))) && glass!.includes(`${pct(gen.scores[0].lo)} to ${pct(gen.scores[0].hi)}`));
  const runLinks = await page.$$('#glass .runs a');
  expect('the glass lists every item the agent answered', runLinks.length === gen.scores[0].tasks, `${runLinks.length}`);
  await runLinks[0].click(); await page.waitForTimeout(2000);
  expect('a run opens with its steps', (await page.$$('.trace li')).length >= 1);

  await go('#/log');
  await page.click('#test-seal'); await page.waitForFunction(() => /seal (holds|is broken)/.test(document.querySelector('#seal-verdict')?.textContent ?? ''), null, { timeout: 30000 });
  expect('testing the seal recomputes the fingerprint written at launch, and it holds', (await page.textContent('#h-rec')) === full.sealed_hash && (await page.textContent('#h-now')) === full.sealed_hash && (await page.textContent('#seal-verdict'))!.includes('The seal holds'));
  await page.click('#regrade'); await page.waitForFunction(() => /answers (agree|do not agree)/.test(document.querySelector('#regrade-verdict')?.textContent ?? ''), null, { timeout: 60000 });
  const answers = full.generations.filter((g: any) => g.generation >= 0).reduce((n: number, g: any) => n + g.runs, 0);
  expect('re-grading in the browser agrees with every recorded answer', (await page.textContent('#regrade-verdict'))!.includes(`All ${answers.toLocaleString('en-GB')} answers agree`), `${answers} answers`);
  const lastRow = await page.$eval(`tr[data-g="${genN}"]`, tr => [tr.querySelector('.rec')!.textContent, tr.querySelector('.again')!.textContent]);
  expect('the best score worked again in the browser matches the API to a tenth', lastRow[0] === lastRow[1] && lastRow[1]!.startsWith((lead.mean * 100).toFixed(1)), lastRow[1] ?? '');
  await go('#/fossils');
  const fossils = await api(`/voyages/${v.id}/fossils`), locker = (await page.textContent('#folio'))!;
  if (!fossils.length) expect('the fossil locker says plainly that it is empty', locker.includes('No skill has been fossilised yet'));
  else {
    expect('the fossil locker names every fossil and gives its real race score', fossils.every((f: any) => locker.includes(`${f.name}, fossilised`) && locker.includes(`${pct(f.race.score)}, against its teacher's ${pct(f.race.teacher)}`)), fossils.map((f: any) => f.name).join(', '));
    expect('each fossil slab is drawn from its training curve', fossils.every((f: any) => Array.isArray(f.curve) && f.curve.length > 1) && (await page.$$('.case-glass canvas')).length === fossils.length);
    await page.uncheck('.ask-fossil input[name=teacher]'); await page.click('.ask-btn');
    await page.waitForFunction(() => !!document.querySelector('.duel'), null, { timeout: 60000 });
    const odds = await page.$$eval('.odds li b', bs => bs.map(b => Number(b.textContent!.replace('%', ''))));
    expect('asking the fossil returns its likeliest places, most likely first, each with a chance', odds.length >= 2 && odds.every((p, i) => i === 0 || p <= odds[i - 1]) && odds[0] > 0, odds.join(' '));
  }

  await go('#/settings', 3000);
  await page.fill('input[name=capGeneration]', '4.5'); await page.click('.actions button'); await page.waitForTimeout(800);
  expect('settings save, and the API reads them back', (await api('/settings')).capGeneration === 4.5, await page.textContent('#saved') ?? '');
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  expect('Escape returns to the ship', !(await page.evaluate(() => document.body.classList.contains('open'))));
  const forged = await fetch(URL + 'api/settings', { method: 'POST', body: '{"seed":9}' });
  expect('a write without the header is refused', forged.status === 403);
  expect('no errors in the page', errors.length === 0, errors.join(' | '));
} catch (e) { expect('the test ran to the end', false, (e as Error).message); }
finally {
  await fetch(URL + 'api/settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-beagle': '1' }, body: JSON.stringify(settingsBefore) });
  await browser.close();
}
const failed = results.filter(r => !r[1]).length;
console.log(`\n${results.length - failed} of ${results.length} passed.`);
process.exitCode = failed ? 1 : 0;
