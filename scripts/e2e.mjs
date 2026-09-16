import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import * as XLSX from 'xlsx';

// End-to-end check of the built app: import a mastersheet, exercise every
// export, and confirm the figures that come back out.
//   npm run build && node scripts/e2e.mjs <path-to-mastersheet.xlsx>
const SHEET = process.argv[2];
if (!SHEET || !existsSync(SHEET)) {
  console.error('usage: node scripts/e2e.mjs <path-to-mastersheet.xlsx>');
  process.exit(2);
}

const OUT = process.env.E2E_OUT || './e2e-out';
mkdirSync(OUT, { recursive: true });
const root = new URL('../dist', import.meta.url).pathname;
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };
const srv = createServer((req,res)=>{
  // Strip the query before mapping to a file, or '/?error=…' resolves to the
  // directory itself.
  const path = req.url.split('?')[0];
  const p = join(root, path === '/' ? 'index.html' : path);
  if (!existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': types[extname(p)] || 'application/octet-stream'});
  res.end(readFileSync(p));
}).listen(5601);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await b.newPage({ viewport: { width: 1440, height: 960 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
// A sandbox that intercepts TLS makes the font request fail; neither that nor a
// missing favicon is the app's doing.
const environmental = /favicon|ERR_CERT_AUTHORITY_INVALID|fonts\.googleapis|fonts\.gstatic|404/;
page.on('console', m => {
  if (m.type() === 'error' && !environmental.test(m.text())) errs.push('CONSOLE ' + m.text());
});
const ok = (label, cond, detail='') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);

await page.goto('http://localhost:5601/', { waitUntil: 'networkidle' });

// 1. import the new mastersheet
await page.setInputFiles('#import-file', SHEET);
await page.waitForTimeout(1800);
const periodCount = await page.locator('.period').count();
ok('import creates periods', periodCount >= 11, `${periodCount} periods`);
const active = (await page.locator('.period.active').innerText()).split('\n')[0];
console.log(`      active period: ${active}`);

const figures = (await page.locator('.figure').allInnerTexts()).map(t=>t.replace(/\n/g,' '));
console.log('      figures:', figures.join(' | '));

// 2. Excel export
const [dl1] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Excel' }).click()]);
const xlPath = join(OUT, 'export.xlsx'); await dl1.saveAs(xlPath);
const wb = XLSX.read(readFileSync(xlPath));
ok('Excel export downloads', dl1.suggestedFilename() === 'PM Payroll.xlsx', dl1.suggestedFilename());
ok('Excel has a sheet per period + summary', wb.SheetNames.length === periodCount + 1, `${wb.SheetNames.length} sheets`);
const sep = XLSX.utils.sheet_to_json(wb.Sheets[active], { header: 1 });
const totalRow = sep.find(r => r[0] === 'TOTAL');
ok('Excel carries the period totals', !!totalRow && totalRow[9] > 0, `earned ${totalRow?.[9]}`);
const divHead = sep.findIndex(r => String(r[0]).startsWith('Name'));
ok('Excel carries the division matrix', divHead > 0 && sep[divHead].length > 3);
const remit = sep.find(r => r[0] === 'Still to remit');
ok('Excel carries the settlement', !!remit, `still to remit ${Math.round(remit?.[1] ?? 0)}`);
const summary = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { header: 1 });
ok('Excel summary lists every period', summary.length === periodCount + 1, `${summary.length - 1} rows`);

// 3. payouts export
await page.getByRole('button', { name: 'Payouts & settlement' }).click();
const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export payouts' }).click()]);
const pPath = join(OUT, 'payouts.xlsx'); await dl2.saveAs(pPath);
const pwb = XLSX.read(readFileSync(pPath));
const prows = XLSX.utils.sheet_to_json(pwb.Sheets['Payouts'], { header: 1 });
const naveed = prows.find(r => typeof r[3] === 'number' && r[3] > 0);
ok('payout export names the file by period', dl2.suggestedFilename() === `Payouts - ${active}.xlsx`, dl2.suggestedFilename());
ok('payout export carries per-person pay', !!naveed, `${naveed?.[0]} ${Math.round(naveed?.[3] ?? 0)}`);
ok('payout export carries the breakdown', String(naveed?.[6] || '').length > 3);

// 4. JSON backup
const [dl3] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
const jPath = join(OUT, 'backup.json'); await dl3.saveAs(jPath);
const backup = JSON.parse(readFileSync(jPath, 'utf8'));
ok('backup downloads valid JSON', backup.periods.length === periodCount, `${backup.periods.length} periods`);

// 5. editing recomputes
await page.getByRole('button', { name: 'Revenue' }).click();
await page.waitForTimeout(200);
const before = await page.locator('.figure').first().innerText();
await page.locator('#usd-pkr').fill('280');
await page.waitForTimeout(300);
const after = await page.locator('.figure').first().innerText();
ok('changing the rate recomputes PKR', before !== after, after.replace(/\n/g,' '));
await page.locator('#usd-pkr').fill('270');
await page.waitForTimeout(200);

// 6. roll forward
await page.getByRole('button', { name: 'New period' }).click();
await page.waitForTimeout(400);
const newLabel = await page.locator('.period.active').innerText();
ok('new period rolls forward under a new label', !newLabel.includes(active), newLabel.replace(/\n/g,' '));
const rowsAfterRoll = await page.locator('table tbody tr').count();
ok('roll-forward keeps the accounts', rowsAfterRoll > 0, `${rowsAfterRoll} rows`);
const unitsCell = await page.locator('table tbody tr').first().locator('td').nth(4).innerText();
ok('roll-forward clears the hours', unitsCell.trim() === '0', `units ${unitsCell.trim()}`);

// 7. delete, duplicate
page.on('dialog', d => d.accept());
await page.getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(400);
ok('delete removes the period', (await page.locator('.period').count()) === periodCount, `${await page.locator('.period').count()} left`);
ok('delete lands on a neighbour, not the first period',
   (await page.locator('.period.active').innerText()).includes(active),
   (await page.locator('.period.active').innerText()).replace(/\n/g,' '));

// 8. persistence
await page.reload({ waitUntil: 'networkidle' });
ok('state survives reload', (await page.locator('.period').count()) === periodCount);

// 9. wages settled locally
{
  await page.getByRole('button', { name: new RegExp(active) }).first().click();
  await page.getByRole('button', { name: 'Payouts & settlement' }).click();
  await page.waitForTimeout(400);

  const remitLine = () => page.locator('.settle .row.final dd').first().innerText();
  const before = await remitLine();

  const firstRetain = page.locator('input[type=checkbox]').first();
  await firstRetain.check();
  await page.waitForTimeout(400);
  const after = await remitLine();
  ok('marking someone paid here lowers what must be remitted', before !== after, `${before} → ${after}`);
  ok('the settlement names the wages paid here',
     /Wages paid here/.test(await page.locator('.settle').innerText()));
  ok('the wages panel lists the person', /pay/.test(await page.locator('.panel.wages').innerText()));

  await page.locator('.panel.wages').getByRole('button', { name: 'Add' }).click();
  await page.waitForTimeout(200);
  const drawn = page.locator('.panel.wages').locator('input[type=number]').first();
  await drawn.fill('50000');
  await page.waitForTimeout(500);
  const afterDraw = await remitLine();
  ok('a drawn wage lowers it further', afterDraw !== after, `${after} → ${afterDraw}`);
  ok('apply-to-all is offered once somebody is marked',
     (await page.getByRole('button', { name: 'Apply to all periods' }).count()) === 1);
  await page.getByRole('button', { name: 'Apply to all periods' }).click();
  await page.waitForTimeout(600);
  ok('applying across periods reports what it did',
     /paid here in \d+ more periods|Already applied/.test(await page.locator('.toast').innerText().catch(() => '')));
}

// 10. division allocation display
await page.getByRole('button', { name: new RegExp(active) }).first().click();
await page.getByRole('button', { name: 'Division' }).click();
await page.waitForTimeout(300);
const allocs = await page.locator('tfoot .alloc-ok, tfoot .alloc-off').allInnerTexts();
ok('every account fully allocated', allocs.length > 0 && allocs.every(a => a === '100%'), allocs.join(' '));

await page.getByRole('button', { name: 'Revenue' }).click();
await page.screenshot({ path: join(OUT, 'revenue.png'), fullPage: false });
await page.getByRole('button', { name: 'Payouts & settlement' }).click();
await page.screenshot({ path: join(OUT, 'payouts.png'), fullPage: false });
await page.emulateMedia({ colorScheme: 'dark' });
await page.getByRole('button', { name: 'Division' }).click();
await page.screenshot({ path: join(OUT, 'division-dark.png'), fullPage: false });

console.log(errs.length ? '\nJS ERRORS:\n' + errs.join('\n') : '\nNo JS errors.');
console.log(`Screenshots and exported files in ${OUT}`);
await b.close(); srv.close();
process.exit(errs.length ? 1 : 0);
