/**
 * Upwork's decimal hours land in an hours-and-minutes month as hours and minutes.
 *
 *   npm run build && node scripts/e2e-hours.mjs
 *
 * Upwork writes 36 hours 50 minutes as 36.83. A month that reads 12.20 as
 * 12 hours 20 minutes must be handed 36.50, or it bills 36 hours 83 minutes.
 * Runs the real import against the built app in local mode, with a made-up
 * month and a made-up report — no payroll data.
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join } from 'path';

const root = new URL('../dist', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const p = join(root, path === '/' ? 'index.html' : path);
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(5651);

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const account = (id, name, entries) => ({
  id, name, owner: '', currency: 'USD', rate: 9, entries, feePct: 10, adjustmentUsd: 0,
  freelancerPct: 70, status: 'Pending', receivedAmount: null, aliases: [], paidDirect: false,
  cycleStart: '', cycleEnd: '', notes: '',
});
const month = (id, label, timeFormat) => ({
  id, label, usdToPkr: 280, timeFormat, staff: [], reimbursements: [], otherPayables: [],
  withheld: [], localWages: [], transfers: [], visibility: 'core', ignoredProjects: [],
  accounts: [account(`${id}-a`, 'Some Client LLC', [0])],
});
const seed = {
  version: 1, activePeriodId: 'oct',
  periods: [month('sep', 'September 2026', 'decimal'), month('oct', 'October 2026', 'hm')],
};

const head = 'Date,Transaction ID,Transaction type,Transaction summary,Transaction summary details,Description 1,Description 2,Client team,Amount $';
const week = (id, paid, span, hours, amount) => [
  `"${paid}",${id},Service Fee,Outreach,"Earnings for ${span}",Service fee,$${amount.toFixed(2)} x 10.0% = $${(amount / 10).toFixed(2)},Some Client LLC,-${(amount / 10).toFixed(2)}`,
  `"${paid}",${id},Hourly,Outreach,"Earnings for ${span}","Earnings for ${span}",${hours} hours x $9.00 = $${amount.toFixed(2)},Some Client LLC,${amount.toFixed(2)}`,
];
const csv = [head,
  ...week(1, 'Oct 9, 2026', 'Sep 28-Oct 4, 2026', '40.00', 360),
  ...week(2, 'Oct 16, 2026', 'Oct 5-Oct 11, 2026', '40.00', 360),
  ...week(3, 'Oct 23, 2026', 'Oct 12-Oct 18, 2026', '36.83', 331.5),
  ...week(4, 'Oct 30, 2026', 'Oct 19-Oct 25, 2026', '40.00', 360),
].join('\n');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/seed.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seed) }));

/** Import the four weeks into the open month, replacing what it had. */
const importWeeks = async () => {
  await page.getByRole('button', { name: 'Revenue' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Add a week' }).click();
  await page.waitForTimeout(300);
  await page.locator('.week input[type=file]').setInputFiles({ name: 'report.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^Match 4 weeks/ }).click();
  await page.waitForTimeout(400);
  const review = await page.locator('.week tbody tr').first().innerText();
  await page.locator('.week tbody tr').first().locator('select').nth(1).selectOption('replace');
  await page.getByRole('button', { name: /^Apply to/ }).click();
  await page.waitForTimeout(500);
  const row = page.locator('table tbody tr').first();
  return {
    review,
    box: await row.locator('input.entries').inputValue(),
    total: (await row.locator('td').nth(4).innerText()).trim(),
    beforeFee: (await row.locator('td').nth(5).innerText()).trim(),
    notices: await page.locator('.notices').count() ? await page.locator('.notices').innerText() : '',
  };
};

await page.goto('http://localhost:5651', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// October reads 12.20 as 12 hours 20 minutes.
const oct = await importWeeks();
ok('the review shows the four weeks as 156 hours 50 minutes', /156h 50m/.test(oct.review), oct.review.replace(/\s+/g, ' '));
ok('an hours-and-minutes month is given 156.50, not 156.83', oct.box === '156.50', oct.box);
ok('its total time is 156 hours 50 minutes', oct.total === '156h 50m', oct.total);
ok('rate times time is what Upwork paid, $1,411.50', oct.beforeFee === '$1,411.50', oct.beforeFee);
ok('no impossible minutes are flagged', !/minutes/.test(oct.notices), oct.notices);

// September reads 12.20 as 12.2 hours: there the decimal stays a decimal.
await page.getByRole('button', { name: /^September/ }).click();
await page.waitForTimeout(400);
const sep = await importWeeks();
ok('a decimal month keeps Upwork\'s decimal hours', sep.box === '156.83', sep.box);
ok('and also comes to 156 hours 50 minutes', sep.total === '156h 50m', sep.total);
// Upwork's 36.83 is itself rounded, so a decimal month bills 3 cents under —
// as it always has; only an hours-and-minutes month gets the minutes exact.
ok('and bills Upwork\'s own rounded hours', sep.beforeFee === '$1,411.47', sep.beforeFee);

ok('no page errors', errors.length === 0, errors.join('; '));
await browser.close();
srv.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nUpwork hours land as hours and minutes');
process.exit(failures ? 1 : 0);
