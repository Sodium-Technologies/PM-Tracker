/**
 * Loans: recorded, repaid, kept — and kept apart from the months.
 *
 *   npm run build && node scripts/e2e-loans.mjs
 *
 * Runs against the built app in local mode with a made-up month. Who may see
 * loans when the books are shared is the database's business, and is checked
 * in scripts/rls-checks.sh and scripts/e2e-auth.mjs.
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
}).listen(5652);

let failures = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const seed = {
  version: 1, activePeriodId: 'oct',
  periods: [{
    id: 'oct', label: 'October 2026', usdToPkr: 280, timeFormat: 'hm', visibility: 'core', ignoredProjects: [],
    reimbursements: [], otherPayables: [], withheld: [], localWages: [], transfers: [],
    accounts: [{ id: 'a1', name: 'Some Client', owner: '', currency: 'USD', rate: 10, entries: [40], feePct: 10,
      adjustmentUsd: 0, freelancerPct: 70, status: 'Pending', receivedAmount: null, aliases: [], paidDirect: false,
      cycleStart: '', cycleEnd: '', bonusIds: [], notes: '' }],
    staff: [{ id: 's1', name: 'Ali', shares: { a1: 1 }, adjustmentPkr: 0, retained: false, advancePkr: 0, notes: '' }],
  }],
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.route('**/seed.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seed) }));
await page.goto('http://localhost:5652', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const monthFigures = async () => (await page.locator('.figures').first().innerText()).replace(/\s+/g, ' ');
const before = await monthFigures();
const rail = async () => (await page.locator('.period-list').innerText()).replace(/\s+/g, ' ');
const railBefore = await rail();

ok('loans sit under the dashboard',
   (await page.locator('.rail-nav .rail-link').allInnerTexts()).join('|') === 'Dashboard|Loans|Settings',
   (await page.locator('.rail-nav .rail-link').allInnerTexts()).join('|'));
await page.getByRole('button', { name: 'Loans', exact: true }).click();
await page.waitForTimeout(300);
ok('the loans page says it is private and belongs to no month', /only you can see these/.test(await page.locator('.head').innerText()));
ok('the month tabs are not on it', (await page.locator('.tabs').count()) === 0);
ok('nothing recorded yet', /No loans recorded yet/.test(await page.locator('.loan-table').innerText()));
ok('the payroll people are offered', (await page.locator('#loan-people option').count()) === 1);

const record = async (who, amount, { direction = 'lent', currency = 'PKR', date = '2026-10-05', note = '' } = {}) => {
  await page.getByLabel('Loan date').fill(date);
  await page.locator('#loan-who').fill(who);
  await page.locator('#loan-direction').selectOption(direction);
  await page.locator('#loan-amount').fill(String(amount));
  await page.getByLabel('Currency', { exact: true }).selectOption(currency);
  if (note) await page.getByLabel('Loan note').fill(note);
  await page.getByRole('button', { name: 'Record loan' }).click();
  await page.waitForTimeout(200);
};
const figures = async () => (await page.locator('.loans .figures').innerText()).replace(/\s+/g, ' ');
const rowOf = (who) => page.locator('.loan-row').filter({ has: page.locator(`input[value="${who}"]`) });

ok('a loan needs someone and an amount', await page.getByRole('button', { name: 'Record loan' }).isDisabled());
await record('Ali', 50000, { note: 'house rent' });
ok('a loan is recorded', (await page.locator('.loan-row').count()) === 1);
ok('it is owed to you', /Owed to you PKR 50,000/i.test(await figures()), await figures());

// Recording a repayment from the form at the top.
const repayForm = page.locator('#record-repayment');
ok('the repayment form waits for a loan to be chosen', await repayForm.getByRole('button', { name: 'Record repayment' }).isDisabled());
ok('it offers the open loans', /Ali — PKR 50,000 left \(lent 5 Oct 2026\)/.test(await page.locator('#repay-loan').innerText()),
   await page.locator('#repay-loan').innerText());
await page.locator('#repay-loan').selectOption({ label: 'Ali — PKR 50,000 left (lent 5 Oct 2026)' });
await page.getByLabel('Date of this repayment').fill('2026-10-20');
await page.locator('#repay-amount').fill('60000');
ok('paying back more than is owed is warned about', /more than the PKR 50,000 left/.test(await repayForm.innerText()));
await page.locator('#repay-amount').fill('20000');
await repayForm.getByRole('button', { name: 'Record repayment' }).click();
await page.waitForTimeout(200);
ok('it says what was recorded and what is left',
   /Recorded PKR 20,000 from Ali\. PKR 30,000 is still owed to you\./.test(await repayForm.innerText()), await repayForm.innerText());
ok('a repayment brings the balance down', /PKR 30,000/.test(await rowOf('Ali').innerText()), (await rowOf('Ali').innerText()).replace(/\s+/g, ' '));
ok('and is counted as repaid', /Repaid so far PKR 20,000/i.test(await figures()), await figures());
ok('the loan is still open', /Open/.test(await rowOf('Ali').locator('.loan-status').innerText()));
ok('each loan shows how many repayments it has', /Repayments \(1\)/.test(await rowOf('Ali').innerText()));
const history = page.locator('.repayment-table');
ok('the repayment is listed with the others', /Ali\s+20 Oct 2026\s+Paid back to you\s+PKR 20,000/.test(await history.innerText()),
   (await history.innerText()).replace(/\s+/g, ' '));

// And from the loan itself.
await rowOf('Ali').getByRole('button', { name: /^Repayments/ }).click();
await page.waitForTimeout(200);
ok('a loan opens to its own repayments', (await page.locator('.loan-detail').count()) === 1);
await page.locator('.loan-detail').getByRole('button', { name: /Repaid in full/ }).click();
await page.waitForTimeout(200);
ok('repaying in full settles it', (await page.locator('.loan-row').count()) === 0
   && /Every loan is repaid/.test(await page.locator('.loan-table').innerText()));
ok('nothing is owed to you any more', /Owed to you PKR 0 /i.test(await figures()), await figures());
ok('a settled loan is no longer offered for repayment', !/Ali/.test(await page.locator('#repay-loan').innerText()));
ok('both repayments are listed', (await history.locator('tbody tr').count()) === 2);
await page.getByRole('button', { name: /^All \(/ }).click();
await page.waitForTimeout(200);
ok('a repaid loan is still there under All', /Repaid/.test(await rowOf('Ali').locator('.loan-status').innerText()));

// A repayment deleted from the list reopens the loan.
await history.getByRole('button', { name: /Delete the repayment of PKR 20,000 from Ali/ }).click();
await page.waitForTimeout(200);
ok('deleting a repayment puts the balance back', /PKR 20,000/.test(await rowOf('Ali').locator('td').nth(5).innerText())
   && /Open/.test(await rowOf('Ali').locator('.loan-status').innerText()), (await rowOf('Ali').innerText()).replace(/\s+/g, ' '));

await record('Bank', 100, { direction: 'borrowed', currency: 'USD' });
ok('money borrowed is what you owe, in its own currency', /You owe \$100\.00/i.test(await figures()), await figures());
ok('where each person stands', /Bank.*-?\$100\.00.*you owe them/.test((await page.locator('.loans .panel').last().innerText()).replace(/\s+/g, ' ')),
   (await page.locator('.loans .panel').last().innerText()).replace(/\s+/g, ' '));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Loans', exact: true }).click();
await page.getByRole('button', { name: /^All \(/ }).click();
await page.waitForTimeout(200);
ok('loans are kept', (await page.locator('.loan-row').count()) === 2);
ok('and so are their repayments', (await page.locator('.repayment-table tbody tr').count()) === 1);

await rowOf('Bank').getByRole('button', { name: /Delete the loan/ }).click();
await page.waitForTimeout(200);
ok('a loan can be deleted', (await page.locator('.loan-row').count()) === 1);

await page.getByRole('button', { name: /Back to/ }).click();
await page.waitForTimeout(300);
ok('no month figure moved', (await monthFigures()) === before, `${before} → ${await monthFigures()}`);
ok('nor any month in the list', (await rail()) === railBefore);
const backup = await page.evaluate(() => localStorage.getItem('pm-payroll-state-v1') ?? '');
ok('loans are not saved inside the books', !/house rent|borrowed/.test(backup));

ok('no page errors', errors.length === 0, errors.join('; '));
await browser.close();
srv.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nLoans are recorded, repaid and kept apart from the months');
process.exit(failures ? 1 : 0);
