import * as XLSX from 'xlsx';
import type { Account, Period, StaffMember } from './types';
import { computePeriod, round2, sum as sumEntries } from './calc';
import { addr, evalCell, formulaOf, rawValue, referencesCell, splitEntries } from './sheetFormula';
import { newAccount, newPeriod, newStaff, uid } from './state';

type Grid = (string | number | null)[][];

const text = (v: unknown) => (v == null ? '' : String(v).trim());
const num = (v: unknown) => {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function toGrid(ws: XLSX.WorkSheet): Grid {
  return XLSX.utils.sheet_to_json<Grid[number]>(ws, { header: 1, raw: true, defval: null }) as Grid;
}

function findHeaderRow(grid: Grid): number {
  for (let r = 0; r < grid.length; r++) {
    const cells = (grid[r] || []).map((c) => norm(text(c)));
    if (cells.includes('rate') && cells.includes('hours') && cells.includes('earned')) return r;
  }
  return -1;
}

function colIndex(row: Grid[number], ...names: string[]): number {
  const wanted = names.map(norm);
  for (let c = 0; c < row.length; c++) if (wanted.includes(norm(text(row[c])))) return c;
  return -1;
}

/** Carry across what the row's own cells said but the model cannot hold:
 *  logged hours on an invoiced line, and a PKR figure that was converted at a
 *  rate other than the period's (money received in several transfers). */
function buildNote(
  invoiced: boolean, units: number, earned: number,
  earnedPkr: number, usdToPkr: number, currency: 'USD' | 'PKR',
): string {
  const parts: string[] = [];
  if (invoiced && units) parts.push(`${round2(units)} hours logged`);
  if (currency === 'USD' && earned && earnedPkr) {
    const implied = earned * usdToPkr;
    if (Math.abs(implied - earnedPkr) / Math.max(implied, 1) > 0.01)
      parts.push(`sheet showed ${Math.round(earnedPkr)} PKR (converted at ${round2(earnedPkr / earned)})`);
  }
  return parts.join(' · ');
}

/** Parse one month sheet of a PM mastersheet into a Period.
 *  Columns are located by header text, and the arithmetic is recovered from the
 *  cell formulas (fee multipliers, one-off adjustments, individual time entries)
 *  rather than guessed from the printed totals. */
export function parseSheet(label: string, ws: XLSX.WorkSheet): Period | null {
  const grid = toGrid(ws);
  const hr = findHeaderRow(grid);
  if (hr < 0) return null;
  const H = grid[hr];

  const cRate = colIndex(H, 'Rate');
  const cHours = colIndex(H, 'Hours');
  const cEarned = colIndex(H, 'Earned');
  const cFreelancer = colIndex(H, 'Freelancer');
  const cFreelancerPkr = colIndex(H, 'Freelancer - PKR');
  const cStatus = colIndex(H, 'Status');
  const cAccount = colIndex(H, 'Account');
  const cConv = colIndex(H, 'Conversion');
  const cReimb = colIndex(H, 'Reimbursements');
  // Newer sheets state the fee in its own column as a fraction (0.15) instead of
  // burying it in the earned formula.
  const cFeeDeduction = colIndex(H, 'Fee Deduction', 'Fee', 'Deduction');
  // A one-off amount a percentage cannot express: a platform true-up, a bonus
  // carried from another engagement, a correction.
  const cAdjustment = colIndex(H, 'Adjustment', 'Adjust');

  const period = newPeriod(label, 0);
  // A spreadsheet that multiplies rate by 12.2 meant 12.2 hours. Reading those
  // same numbers as 12 h 20 m would silently change every figure in the month,
  // so an imported month keeps the meaning it was written with.
  period.timeFormat = 'decimal';

  if (cConv >= 0) {
    for (let r = hr + 1; r < Math.min(grid.length, hr + 6); r++) {
      const v = num(grid[r]?.[cConv]);
      if (v > 1) { period.usdToPkr = v; break; }
    }
  }
  if (!period.usdToPkr) period.usdToPkr = 280;

  /** PKR cells for each revenue row, used later to recover staff adjustments. */
  const freelancerPkrByRow: Record<string, number> = {};
  /** sheet row number (1-based) -> account id, so the division formulas can be read. */
  const accountByRow: Record<number, string> = {};
  const reimbursementPkrCells: string[] = [];

  for (let r = hr + 1; r < grid.length; r++) {
    const name = text(grid[r]?.[0]);
    if (!name) break;

    let rate = num(grid[r]?.[cRate]);
    const aHours = addr(cHours, r);
    const aEarned = addr(cEarned, r);
    let earned = num(grid[r]?.[cEarned]);
    // A row with no USD figure but a PKR one is settled directly in rupees.
    const earnedPkrCell = num(grid[r]?.[colIndex(H, 'Earned - PKR')]);
    const currency: 'USD' | 'PKR' = !earned && earnedPkrCell ? 'PKR' : 'USD';
    if (currency === 'PKR') { earned = earnedPkrCell; rate = earnedPkrCell; }

    const entries = currency === 'PKR' ? [1] : (splitEntries(ws, aHours) ?? [num(grid[r]?.[cHours])]);
    let units = sumEntries(entries);

    // Recover `earned = gross x multiplier + adjustment` by re-evaluating the
    // earned formula at two different hour counts.
    const statedFee = cFeeDeduction >= 0 ? num(grid[r]?.[cFeeDeduction]) : 0;
    const statedAdjustment = cAdjustment >= 0 ? num(grid[r]?.[cAdjustment]) : 0;
    let multiplier = 1;
    let adjustmentUsd = 0;
    const f0 = currency === 'PKR' ? null : evalCell(ws, aEarned, { [aHours]: units });
    const f1 = evalCell(ws, aEarned, { [aHours]: units + 1 });
    if (f0 != null && f1 != null && rate) {
      multiplier = round2((f1 - f0) / rate * 1000) / 1000;
      adjustmentUsd = round2(f0 - multiplier * rate * units);
    } else if (rate && units) {
      // No usable formula: fall back to the printed numbers, preferring a clean
      // percentage discount and treating anything else as a one-off amount.
      const pct = ((rate * units - earned) / (rate * units)) * 100;
      const halfPct = Math.round(pct * 2) / 2; // discounts are set in whole or half points
      if (pct > 0 && pct < 60 && Math.abs(pct - halfPct) < 0.02) {
        multiplier = 1 - halfPct / 100;
      } else {
        adjustmentUsd = round2(earned - rate * units);
      }
    } else {
      adjustmentUsd = round2(earned);
    }

    // An earned figure that does not move with the hours is an invoiced amount
    // (a list of payouts pasted in), so it is carried as a single fixed line and
    // the logged hours are kept as a note.
    const invoiced = Math.abs(multiplier) < 0.01 && adjustmentUsd !== 0;

    // A multiplier above 1 is a unit count (e.g. "x 4 weeks"), not a discount.
    if (multiplier >= 1.5 && Math.abs(multiplier - Math.round(multiplier)) < 0.01) {
      const k = Math.round(multiplier);
      entries.splice(0, entries.length, ...Array.from({ length: k }, () => units));
      units *= k;
      multiplier = 1;
    }

    const freelancer = num(grid[r]?.[cFreelancer]);
    const freelancerPct = earned ? round2((freelancer / earned) * 100) : 70;

    const account = newAccount({
      name,
      currency,
      owner: cAccount >= 0 ? text(grid[r]?.[cAccount]) : '',
      rate: invoiced ? round2(adjustmentUsd) : rate,
      entries: invoiced ? [1] : entries,
      // The stated fee wins when the sheet has a fee column: it is the number the
      // user maintains, and it survives editing the hours afterwards.
      feePct: invoiced ? 0 : statedFee > 0 ? round2(statedFee * 100) : round2((1 - multiplier) * 100),
      adjustmentUsd: invoiced ? 0 : statedAdjustment || adjustmentUsd,
      notes: buildNote(invoiced, units, earned, earnedPkrCell, period.usdToPkr, currency),
      freelancerPct: freelancerPct || 70,
      status: cStatus >= 0 ? text(grid[r]?.[cStatus]) || 'Pending' : 'Pending',
    });
    period.accounts.push(account);
    accountByRow[r + 1] = account.id;
    if (cFreelancerPkr >= 0) freelancerPkrByRow[account.id] = num(grid[r]?.[cFreelancerPkr]);

    if (cReimb >= 0) {
      const amt = num(grid[r]?.[cReimb]);
      const rlabel = text(grid[r]?.[cReimb + 1]);
      // The USD figure sits next to its label; the row under it holds the PKR
      // conversion, which is the same money and must not be counted twice.
      if (amt > 0 && rlabel && !Number.isFinite(Number(rlabel))) {
        period.reimbursements.push({ id: uid(), label: rlabel, amountUsd: amt });
        reimbursementPkrCells.push(addr(cReimb, r + 1));
      }
    }
  }

  // Division matrix.
  let dr = -1;
  for (let r = hr; r < grid.length; r++) {
    const cells = (grid[r] || []).map((c) => norm(text(c)));
    if (cells.includes('name') && cells.includes('pay')) { dr = r; break; }
  }
  let staffEnd = dr;
  if (dr >= 0) {
    const D = grid[dr];
    const cPay = colIndex(D, 'Pay');
    const colToAccount: Record<number, string> = {};

    // The pay formula spells out the mapping — `(G$2*C15)` means division column
    // C pays out of the revenue row on sheet row 2. That beats matching header
    // text, which is a label ("LUXE - Bonus") rather than the account name.
    const payFormula = cPay >= 0 ? formulaOf(ws, addr(cPay, dr + 1)) : null;
    if (payFormula) {
      const pair = /\$?([A-Z]{1,3})\$?(\d+)\s*\*\s*\$?([A-Z]{1,3})\$?(\d+)/g;
      for (const m of payFormula.matchAll(pair)) {
        const left = { col: XLSX.utils.decode_col(m[1]), row: Number(m[2]) };
        const right = { col: XLSX.utils.decode_col(m[3]), row: Number(m[4]) };
        const [src, div] = left.col === cFreelancerPkr ? [left, right] : [right, left];
        const accId = accountByRow[src.row];
        if (accId != null) colToAccount[div.col] = accId;
      }
    }
    if (!Object.keys(colToAccount).length) {
      // No formula to read (a pasted-in sheet): fall back to header text.
      for (let c = 0; c < D.length; c++) {
        const head = text(D[c]);
        if (!head || norm(head) === 'name' || norm(head) === 'pay') continue;
        const match =
          period.accounts.find((a) => norm(a.name) === norm(head)) ||
          period.accounts.find((a) => norm(a.name).includes(norm(head)) || norm(head).includes(norm(a.name)));
        if (match) colToAccount[c] = match.id;
      }
    }

    for (let r = dr + 1; r < grid.length; r++) {
      const name = text(grid[r]?.[0]);
      if (!name) break;
      staffEnd = r;
      const shares: Record<string, number> = {};
      let expected = 0;
      for (const [c, accId] of Object.entries(colToAccount)) {
        const v = num(grid[r]?.[Number(c)]);
        if (v) { shares[accId] = v; expected += v * (freelancerPkrByRow[accId] || 0); }
      }
      // Anything the printed pay holds beyond the shares is a manual correction.
      const paid = cPay >= 0 ? num(grid[r]?.[cPay]) : 0;
      // Only a deliberate correction counts; anything under 100 PKR is rounding.
      const delta = paid ? round2(paid - expected) : 0;
      period.staff.push(
        newStaff({ name, shares, adjustmentPkr: Math.abs(delta) > 100 ? delta : 0 }),
      );
    }
  }

  // Rows under the division block that carry a PKR figure are payables outside
  // the matrix (an outside contractor paid in PKR).
  for (let r = staffEnd + 1; r < grid.length; r++) {
    const name = text(grid[r]?.[0]);
    if (!name || /usd/i.test(name)) continue;
    const amount = num(grid[r]?.[1]);
    if (amount > 0) period.otherPayables.push({ id: uid(), label: name, amountPkr: amount });
  }

  // Labelled ledger cells, wherever they sit on the sheet.
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r] || []).length; c++) {
      const t = norm(text(grid[r][c]));
      const valueCell = addr(c + 1, r);
      const amount = num(grid[r][c + 1]);
      if (!amount) continue;
      if (t === 'transferedpriorly' || t === 'transferredpriorly' || t === 'transferred') {
        // These totals usually fold in the reimbursement PKR and any retained
        // pay; both are accounted for separately here, so take them back out.
        const f = formulaOf(ws, valueCell) || '';
        let net = amount;
        for (const rc of reimbursementPkrCells)
          if (referencesCell(f, rc)) net -= rawValue(ws, rc);
        if (net > 0) period.transfers.push({ id: uid(), label: 'Transferred priorly', amountPkr: round2(net), date: '' });
      } else if (t === 'nakept') {
        // "Kept NA equity" is a running memo of the same money, not a second
        // deduction, so only the amount actually held back is taken here.
        period.withheld.push({ id: uid(), label: text(grid[r][c]), amountPkr: amount });
      }
    }
  }
  return period;
}

export async function importWorkbook(file: File): Promise<Period[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const periods: Period[] = [];
  for (const name of wb.SheetNames) {
    const p = parseSheet(name.trim(), wb.Sheets[name]);
    if (p && p.accounts.length) periods.push(p);
  }
  return periods;
}

/** Export every period: one revenue+division sheet per period, plus a summary. */
export function exportWorkbook(periods: Period[], filename: string) {
  const wb = XLSX.utils.book_new();
  // Sheet names must be unique and at most 31 characters, and two periods can
  // legitimately carry the same label — so number the duplicates rather than
  // letting the whole export fail.
  const used = new Set<string>();
  const sheetName = (label: string) => {
    const base = (label.trim() || 'Period').slice(0, 31);
    if (!used.has(base)) { used.add(base); return base; }
    for (let n = 2; ; n++) {
      const candidate = `${base.slice(0, 31 - String(n).length - 3)} (${n})`;
      if (!used.has(candidate)) { used.add(candidate); return candidate; }
    }
  };

  const summary: (string | number)[][] = [
    ['Period', 'USD→PKR', 'Gross USD', 'Fees USD', 'Earned USD', 'Freelancer USD', 'Company USD', 'Staff pay PKR', 'Transferable PKR', 'Remaining PKR'],
  ];

  for (const p of periods) {
    const res = computePeriod(p);
    summary.push([
      p.label, p.usdToPkr, res.totals.grossUsd, res.totals.feeUsd, res.totals.earnedUsd,
      res.totals.freelancerUsd, res.totals.companyUsd, res.totals.staffPayPkr,
      res.ledger.transferablePkr, res.ledger.remainingPkr,
    ]);

    const rows: (string | number)[][] = [
      ['Account', 'Owner', 'Currency', 'Rate', 'Units', 'Gross', 'Fee %', 'Fee', 'Adjustment', 'Earned USD', 'Earned PKR', 'Freelancer %', 'Freelancer USD', 'Freelancer PKR', 'Company USD', 'Company PKR', 'Status', 'Notes'],
    ];
    for (const a of res.accounts) {
      rows.push([
        a.account.name, a.account.owner, a.account.currency, a.account.rate, a.units, a.grossUsd,
        a.account.feePct, a.feeUsd, a.account.adjustmentUsd, a.earnedUsd, a.earnedPkr,
        a.account.freelancerPct, a.freelancerUsd, a.freelancerPkr, a.companyUsd, a.companyPkr,
        a.account.status, a.account.notes,
      ]);
    }
    rows.push(['TOTAL', '', '', '', '', res.totals.grossUsd, '', res.totals.feeUsd, '', res.totals.earnedUsd, res.totals.earnedPkr, '', res.totals.freelancerUsd, res.totals.freelancerPkr, res.totals.companyUsd, res.totals.companyPkr, '', '']);

    rows.push([], ['Division (share of each account\'s freelancer pool)']);
    rows.push(['Name', 'Pay PKR', 'Pay USD', ...res.accounts.map((a) => a.account.name)]);
    for (const s of res.staff) {
      rows.push([s.staff.name, s.payPkr, s.payUsd, ...res.accounts.map((a) => s.staff.shares[a.account.id] || 0)]);
    }
    rows.push(['TOTAL', res.totals.staffPayPkr, '', ...res.accounts.map((a) => round2(a.allocated))]);

    rows.push([], ['Reimbursements']);
    rows.push(['Label', 'USD', 'PKR']);
    for (const r of p.reimbursements)
      rows.push([r.label, r.amountUsd, round2(r.amountUsd * p.usdToPkr)]);

    rows.push([], ['Settlement (PKR)']);
    rows.push(['Team payouts', res.totals.staffPayPkr]);
    for (const o of p.otherPayables) rows.push([`Payable — ${o.label}`, o.amountPkr]);
    rows.push(['Company share', res.totals.companyPkr]);
    rows.push(['Owed this period', res.ledger.transferablePkr]);
    rows.push(['Money received', res.ledger.receivedPkr]);
    rows.push(['Less reimbursements', -res.ledger.reimbursementsPkr]);
    for (const w of res.staff.filter((x) => x.paidHerePkr > 0)) {
      const how = w.staff.retained
        ? (w.drawPkr ? `pay in full, plus ${Math.round(w.drawPkr).toLocaleString()} drawn` : 'pay in full')
        : (w.drawPkr
          ? `advance ${Math.round(w.advanceAgainstPayPkr).toLocaleString()}, drawn ${Math.round(w.drawPkr).toLocaleString()}`
          : 'advance on pay');
      rows.push([`Less wages paid here — ${w.staff.name} (${how})`, -w.paidHerePkr]);
    }
    for (const w of p.localWages)
      rows.push([`Less wages paid here — ${w.label}`, -w.amountPkr]);
    for (const w of p.withheld) rows.push([`Less held back — ${w.label}`, -w.amountPkr]);
    for (const t of p.transfers) rows.push([`Less transferred — ${t.label}${t.date ? ` (${t.date})` : ''}`, -t.amountPkr]);
    rows.push(['Still to remit', res.ledger.remainingPkr]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = rows[0].map(() => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName(p.label));
  }

  const sws = XLSX.utils.aoa_to_sheet(summary);
  sws['!cols'] = summary[0].map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, sws, sheetName('Summary'));
  XLSX.writeFile(wb, filename);
}

/** Strip characters a file system will not accept in a name. */
const safeFilename = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').trim() || 'period';

/** Per-person payout sheet for the active period — what actually gets paid out. */
export function exportPayoutSheet(period: Period) {
  const res = computePeriod(period);
  const rows: (string | number)[][] = [
    [`Payout register — ${period.label}`],
    [`USD→PKR ${period.usdToPkr}`],
    [],
    ['Name', 'Share PKR', 'Adjustment PKR', 'Pay PKR', 'Pay USD',
      'Taken PKR', 'Advance PKR', 'Draw PKR', 'Still owed PKR', 'Settled', 'Breakdown'],
  ];
  for (const s of res.staff) {
    const detail = Object.entries(s.byAccount)
      .map(([id, v]) => `${period.accounts.find((a) => a.id === id)?.name ?? id}: ${Math.round(v).toLocaleString()}`)
      .join('; ');
    rows.push([s.staff.name, s.sharePkr, s.staff.adjustmentPkr, s.payPkr, s.payUsd,
      s.staff.advancePkr, s.advanceAgainstPayPkr, s.drawPkr, s.stillOwedPkr,
      s.staff.retained ? 'Paid here' : 'Remitted', detail]);
  }
  rows.push(['TOTAL', '', '', res.totals.staffPayPkr, round2(res.totals.staffPayPkr / (period.usdToPkr || 1)),
    res.ledger.advancesPkr + res.ledger.drawsPkr, res.ledger.advancesPkr, res.ledger.drawsPkr,
    sumEntries(res.staff.map((s) => s.stillOwedPkr)), '', '']);
  if (period.localWages.length) {
    rows.push([], ['Paid here by hand, outside the division']);
    for (const w of period.localWages) rows.push([w.label, '', '', w.amountPkr, '', '', '', '', '', 'Paid here', '']);
  }
  rows.push([], ['Paid here in total', '', '', res.ledger.localWagesPkr, '', '', '', '', '', '', '']);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 15 }, { wch: 14 }, { wch: 12 },
    { wch: 12 }, { wch: 13 }, { wch: 11 }, { wch: 15 }, { wch: 11 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Payouts');
  XLSX.writeFile(wb, `Payouts - ${safeFilename(period.label)}.xlsx`);
}

export type { Account, StaffMember };
