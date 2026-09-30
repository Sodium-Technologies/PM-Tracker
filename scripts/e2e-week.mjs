/**
 * A week applied to one month must leave every other month exactly as it was.
 *
 *   npm run build && node scripts/e2e-week.mjs
 *
 * Runs against the built app in local mode, seeded from dist/seed.json, so it
 * exercises the real apply path rather than a copy of it.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join } from 'path';

const root = new URL('../dist', import.meta.url).pathname;
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const srv = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const p = join(root, path === '/' ? 'index.html' : path);
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(5650);

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5650', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

/** Every month's headline figures, so a change anywhere is visible. */
const snapshot = async () => {
  const months = await page.locator('.period').allInnerTexts();
  return months.map((m) => m.replace(/\s+/g, ' ').trim());
};

const before = await snapshot();
ok('the books loaded', before.length > 5, `${before.length} months`);

await page.getByRole('button', { name: /^September/ }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Revenue' }).click();
await page.waitForTimeout(400);

const septBefore = await page.locator('.figure').first().innerText();
await page.getByRole('button', { name: 'Add a week' }).click();
await page.waitForTimeout(300);
ok('the panel names the month it will change',
   /September/.test(await page.locator('.week .panel-head h2').innerText()));

// The report is a fixture, so the test does not depend on an upload sticking
// around. Its hours are deliberately unlike the seed's: a no-op must not pass
// for a change.
await page.locator('.week input[type=file]')
  .setInputFiles(new URL('./fixtures/upwork-sample.csv', import.meta.url).pathname);
await page.waitForTimeout(600);
ok('the report is read without anything being typed',
   (await page.locator('.week-weeks tbody tr').count()) === 2,
   `${await page.locator('.week-weeks tbody tr').count()} weeks`);
ok('a withdrawal is reported, not counted as earnings',
   /withdrawal line/.test(await page.locator('.week-actions .settings-note').innerText()));
await page.getByRole('button', { name: /^Match 2 weeks/ }).click();
await page.waitForTimeout(500);
ok('the client is matched on its Upwork name',
   (await page.locator('.week tbody tr').count()) === 1);
await page.locator('.week tbody tr').first().locator('select').nth(1).selectOption('replace');
await page.waitForTimeout(200);
const willHave = await page.locator('.week tbody tr').first().locator('td').last().innerText();
ok('the row says what the client will end up with', /\d/.test(willHave), willHave);
await page.getByRole('button', { name: /^Apply to/ }).click();
await page.waitForTimeout(800);

const septAfter = await page.locator('.figure').first().innerText();
ok('the month it was applied to changed', septBefore !== septAfter,
   `${septBefore.replace(/\n/g, ' ')} -> ${septAfter.replace(/\n/g, ' ')}`);

const after = await snapshot();
const changed = before
  .map((b, i) => (b === after[i] ? null : `${b} -> ${after[i]}`))
  .filter(Boolean);
ok('exactly one month changed', changed.length === 1, changed.join(' | ') || 'none changed');
ok('and it was September', /Sep/i.test(changed[0] ?? ''), changed[0] ?? '');

// and the others are untouched when opened, not merely unchanged in the rail
await page.getByRole('button', { name: /^August/ }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Revenue' }).click();
await page.waitForTimeout(400);
const augClients = await page.locator('table tbody tr').count();
ok('August still has its own clients', augClients > 0, `${augClients} rows`);
ok('no page errors', errors.length === 0, errors.join('; '));

// dismissing a project sticks, and takes its money out of the week totals
await page.getByRole('button', { name: 'Add a week' }).click();
await page.waitForTimeout(300);
await page.locator('.week input[type=file]')
  .setInputFiles(new URL('./fixtures/upwork-sample.csv', import.meta.url).pathname);
await page.waitForTimeout(600);
const totalBefore = (await page.locator('.week-weeks tfoot').innerText()).replace(/\s+/g, ' ');
await page.getByRole('button', { name: /^Match 2 weeks/ }).click();
await page.waitForTimeout(400);
await page.locator('.week tbody tr').first().locator('select').first().selectOption('__ignore');
await page.waitForTimeout(200);
ok('a dismissed row says nothing will happen to it',
   (await page.locator('.week tbody tr').first().locator('td').last().innerText()).trim() === '—');
await page.getByRole('button', { name: /^Apply to/ }).click();
await page.waitForTimeout(800);

await page.getByRole('button', { name: 'Add a week' }).click();
await page.waitForTimeout(300);
await page.locator('.week input[type=file]')
  .setInputFiles(new URL('./fixtures/upwork-sample.csv', import.meta.url).pathname);
await page.waitForTimeout(600);
const totalAfter = (await page.locator('.week-weeks tfoot').innerText()).replace(/\s+/g, ' ');
ok('a dismissed project is out of the week totals next time',
   totalBefore !== totalAfter, `${totalBefore} -> ${totalAfter}`);
// this fixture has one project, so dismissing it empties the report
ok('a report with nothing left in it says so, and offers nothing to match',
   /has been dismissed/.test(await page.locator('.week .collect-lead').innerText())
   && (await page.getByRole('button', { name: /^Match 0 weeks/ }).isDisabled()));

console.log(failures ? `\n${failures} check(s) failed` : '\nA week stays in its own month');
await browser.close();
srv.close();
process.exit(failures ? 1 : 0);
