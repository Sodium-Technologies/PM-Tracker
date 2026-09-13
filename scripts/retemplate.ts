/**
 * Rewrite a month tab in the current (September 2026) layout.
 *
 *   npm run retemplate -- <mastersheet.xlsx> "<sheet name>" [out.xlsx]
 *
 * Reads the tab with the app's own importer — so whatever the old layout buried
 * in its formulas comes across — and writes it back out as live formulas in the
 * current column order: Projects · Rate · Hours · Fee Deduction · Adjustment ·
 * Earned · … plus the division matrix and the settlement block.
 */
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { parseSheet } from '../src/lib/xlsx';
import { computePeriod, round2 } from '../src/lib/calc';
import type { Period } from '../src/lib/types';

type Cell = string | number | null;

const col = (i: number) => XLSX.utils.encode_col(i);

/** Build the sheet as an array of rows, then patch in formulas by address. */
export function templateSheet(period: Period): XLSX.WorkSheet {
  const res = computePeriod(period);
  const rows: Cell[][] = [];

  rows.push([
    'Projects', 'Rate', 'Hours', 'Fee Deduction', 'Adjustment', 'Earned', 'Earned - PKR',
    'Freelancer', 'Freelancer - PKR', 'Company', 'Company - PKR', 'Status', 'Account',
    'Comments', 'Conversion', null, 'Reimbursements ', null,
  ]);

  // Column letters for the formulas below.
  const C = {
    rate: 'B', hours: 'C', fee: 'D', adj: 'E', earned: 'F', earnedPkr: 'G',
    freelancer: 'H', freelancerPkr: 'I', company: 'J', companyPkr: 'K',
    conv: 'O', reimb: 'Q',
  };

  res.accounts.forEach((a, i) => {
    const r = i + 2; // sheet row number
    const acc = a.account;
    rows.push([
      acc.name,
      acc.rate,
      acc.entries.length > 1 ? null : round2(a.units), // compound entries become a formula below
      acc.feePct ? round2(acc.feePct) / 100 : null,
      acc.adjustmentUsd || null,
      null, null, null, null, null, null,
      acc.status,
      acc.owner || null,
      acc.notes || null,
      i === 0 ? period.usdToPkr : null,
      null,
      // The amount sits next to its label, the way the importer expects to find it.
      period.reimbursements[i] ? period.reimbursements[i].amountUsd : null,
      period.reimbursements[i] ? period.reimbursements[i].label : null,
    ]);
    void r;
  });

  const first = 2;
  const last = res.accounts.length + 1;
  const totalRow = last + 1;

  rows.push([]); // totals row, filled by formula below
  rows.push([], []); // spacing to match the sheet's shape
  rows.push([null, null, 'Division']);

  const divHeadRow = rows.length + 1;
  rows.push([
    'Name', 'Pay',
    ...res.accounts.map((a) => a.account.name),
  ]);
  res.staff.forEach((s) => {
    rows.push([
      s.staff.name, null,
      ...res.accounts.map((a) => s.staff.shares[a.account.id] || null),
    ]);
  });
  const staffFirst = divHeadRow + 1;
  const staffLast = divHeadRow + res.staff.length;

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // A formula cell must carry its value too: the writer drops formula-only cells,
  // and anything reading the file without recalculating needs the number.
  const set = (addr: string, f: string, v: number) => { ws[addr] = { t: 'n', f, v }; };

  res.accounts.forEach((a, i) => {
    const r = i + 2;
    const acc = a.account;
    const inPkr = acc.currency === 'PKR';
    // Native-currency earned: the sheet's Earned column is in the account's own
    // currency, and only a USD account converts into the PKR column.
    const earnedNative = inPkr ? a.earnedPkr : a.earnedUsd;
    if (acc.entries.length > 1) set(`${C.hours}${r}`, acc.entries.join('+'), a.units);
    const gross = `${C.rate}${r}*${C.hours}${r}`;
    const feeTerm = acc.feePct ? `-(${gross})*${C.fee}${r}` : '';
    const adjTerm = acc.adjustmentUsd ? `+${C.adj}${r}` : '';
    set(`${C.earned}${r}`, `(${gross})${feeTerm}${adjTerm}`, earnedNative);
    set(`${C.earnedPkr}${r}`, inPkr ? `${C.earned}${r}` : `${C.earned}${r}*${C.conv}$2`, a.earnedPkr);
    set(`${C.freelancer}${r}`, `${C.earned}${r}*${acc.freelancerPct / 100}`,
      round2(earnedNative * (acc.freelancerPct / 100)));
    set(`${C.freelancerPkr}${r}`, inPkr ? `${C.freelancer}${r}` : `${C.freelancer}${r}*${C.conv}$2`, a.freelancerPkr);
    set(`${C.company}${r}`, `${C.earned}${r}-${C.freelancer}${r}`,
      round2(earnedNative - round2(earnedNative * (acc.freelancerPct / 100))));
    set(`${C.companyPkr}${r}`, inPkr ? `${C.company}${r}` : `${C.company}${r}*${C.conv}$2`, a.companyPkr);
  });

  const totals: Record<string, number> = {
    [C.earned]: res.totals.earnedUsd,
    [C.earnedPkr]: res.totals.earnedPkr,
    [C.freelancer]: res.totals.freelancerUsd,
    [C.freelancerPkr]: res.totals.freelancerPkr,
    [C.company]: res.totals.companyUsd,
    [C.companyPkr]: res.totals.companyPkr,
  };
  for (const c of [C.earned, C.earnedPkr, C.freelancer, C.freelancerPkr, C.company, C.companyPkr])
    set(`${c}${totalRow}`, `SUM(${c}${first}:${c}${last})`, totals[c]);

  // Division pay: the cross-references state which revenue row each column pays from.
  res.staff.forEach((s, i) => {
    const r = staffFirst + i;
    const terms = res.accounts.map((_a, j) =>
      `(${C.freelancerPkr}$${j + 2}*${col(j + 2)}${r})`).join('+');
    set(`B${r}`, terms, s.sharePkr);
  });
  set(`B${staffLast + 2}`, `SUM(B${staffFirst}:B${staffLast})`, res.totals.staffPayPkr);

  // Settlement block, to the right of the division matrix.
  const lc = col(res.accounts.length + 3);
  const vc = col(res.accounts.length + 4);
  const put = (r: number, label: string, value: number, formula?: string) => {
    ws[`${lc}${r}`] = { t: 's', v: label };
    ws[`${vc}${r}`] = formula ? { t: 'n', f: formula, v: value } : { t: 'n', v: value };
  };
  const transfers = round2(period.transfers.reduce((t, x) => t + x.amountPkr, 0));
  put(divHeadRow, 'Transferable', res.ledger.transferablePkr,
    `SUM(B${staffFirst}:B${staffLast})+${C.companyPkr}${totalRow}`);
  put(divHeadRow + 1, 'Reimbursements - PKR', res.ledger.reimbursementsPkr,
    period.reimbursements.length ? `${C.reimb}2*${C.conv}$2` : undefined);
  put(divHeadRow + 2, 'Transfered priorly', transfers);
  put(divHeadRow + 3, 'Remaining', res.ledger.remainingPkr,
    `${vc}${divHeadRow}-${vc}${divHeadRow + 1}-${vc}${divHeadRow + 2}`);

  // The range has to cover whichever reaches furthest right: the header row
  // (conversion and reimbursements sit out past the figures), the division
  // matrix, or the settlement block beside it.
  const lastCol = Math.max(rows[0].length - 1, res.accounts.length + 4, col.length);
  ws['!ref'] = XLSX.utils.encode_range({
    s: { c: 0, r: 0 },
    e: { c: lastCol, r: staffLast + 2 },
  });
  ws['!cols'] = Array.from({ length: lastCol + 1 }, () => ({ wch: 15 }));
  return ws;
}

const [file, sheetName, outPath] = process.argv.slice(2);
if (!file || !sheetName) {
  console.error('usage: npm run retemplate -- <mastersheet.xlsx> "<sheet name>" [out.xlsx]');
  process.exit(2);
}
const wb = XLSX.read(fs.readFileSync(file), { cellFormula: true });
const ws = wb.Sheets[sheetName];
if (!ws) { console.error(`no sheet named "${sheetName}"`); process.exit(2); }
const period = parseSheet(sheetName, ws);
if (!period) { console.error('that sheet is not a payroll tab'); process.exit(2); }

const out = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(out, templateSheet(period), sheetName.slice(0, 31));
const dest = outPath || `${sheetName} (template).xlsx`;
XLSX.writeFile(out, dest);
console.log(`wrote ${dest} — ${period.accounts.length} accounts, ${period.staff.length} people`);
