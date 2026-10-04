/**
 * A page left open notices when a newer version has been deployed.
 *
 *   npm run build && node scripts/e2e-fresh.mjs
 *
 * Serves the built app, then swaps the published index.html for one naming a
 * different bundle — what a deploy looks like from the outside — and checks the
 * page offers to reload, without being told.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join } from 'path';

const root = new URL('../dist', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let deployed = false;
const srv = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const p = join(root, path === '/' ? 'index.html' : path);
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  let body = readFileSync(p);
  if (deployed && p.endsWith('index.html')) {
    body = Buffer.from(body.toString().replace(/assets\/index-[\w-]+\.js/, 'assets/index-NEWBUILD1.js'));
  }
  res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
  res.end(body);
}).listen(5660);

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await (await browser.newContext()).newPage();
await page.goto('http://localhost:5660', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

ok('the page says which version it is', /version [0-9a-f]{7}|version unknown/.test(await page.locator('.build').innerText()),
   await page.locator('.build').innerText());
ok('nothing is offered while it is current', (await page.locator('.update-banner').count()) === 0);

deployed = true;
// what a phone does when the home-screen app is brought back to the front
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(800);
ok('after a deploy, coming back to the page offers the newer version',
   (await page.locator('.update-banner').count()) === 1);
ok('with a way to take it', await page.getByRole('button', { name: 'Reload' }).isVisible());

console.log(failures ? `\n${failures} check(s) failed` : '\nAn open page notices a newer version');
await browser.close();
srv.close();
process.exit(failures ? 1 : 0);
