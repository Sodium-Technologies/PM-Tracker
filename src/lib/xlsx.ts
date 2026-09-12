import * as XLSX from 'xlsx';
import type { Account, Period, StaffMember } from './types';
import { computePeriod, round2 } from './calc';
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

/** Parse one month sheet of a PM mastersheet into a Period. Layout-tolerant:
 *  columns are located by their header text, not by fixed letters. */
export function parseSheet(label: string, ws: XLSX.WorkSheet): Period | null {
  const grid = toGrid(ws);
  const hr = findHeaderRow(grid);
  if (hr < 0) return null;
  const H = grid[hr];

  const cRate = colIndex(H, 'Rate');
  const cHours = colIndex(H, 'Hours');
  const cEarned = colIndex(H, 'Earned');
  const cFreelancer = colIndex(H, 'Freelancer');
  const cStatus = colIndex(H, 'Status');
  const cAccount = colIndex(H, 'Account');
  const cConv = colIndex(H, 'Conversion');
  const cReimb = colIndex(H, 'Reimbursements');
  const cName = 0;

  const period = newPeriod(label, 0);

  if (cConv >= 0) {
    for (let r = hr + 1; r < Math.min(grid.length, hr + 6); r++) {
      const v = num(grid[r]?.[cConv]);
      if (v > 1) { period.usdToPkr = v; break; }
    }
  }
  if (!period.usdToPkr) period.usdToPkr = 280;

  // Revenue rows: contiguous named rows under the header.
  for (let r = hr + 1; r < grid.length; r++) {
    const name = text(grid[r]?.[cName]);
    if (!name) break;
    const rate = num(grid[r]?.[cRate]);
    const hours = num(grid[r]?.[cHours]);
    const earned = num(grid[r]?.[cEarned]);
    const freelancer = num(grid[r]?.[cFreelancer]);
    const gross = round2(rate * hours);

    let feePct = 0;
    let adjustmentUsd = 0;
    if (gross > 0 && earned) {
      const diff = round2(gross - earned);
      const pct = round2((diff / gross) * 100);
      // A clean percentage discount is kept as a fee; anything else is a one-off.
      if (pct > 0 && pct < 50 && Math.abs(pct - Math.round(pct * 100) / 100) < 0.001) feePct = pct;
      else adjustmentUsd = round2(earned - gross);
    } else if (!gross && earned) {
      adjustmentUsd = earned;
    }
    const freelancerPct = earned ? round2((freelancer / earned) * 100) : 70;

    period.accounts.push(
      newAccount({
        name,
        owner: cAccount >= 0 ? text(grid[r]?.[cAccount]) : '',
        rate,
        entries: [hours],
        feePct,
        adjustmentUsd,
        freelancerPct: freelancerPct || 70,
        status: cStatus >= 0 ? text(grid[r]?.[cStatus]) || 'Pending' : 'Pending',
        mode: rate > 100 ? 'fixed' : 'hourly',
      }),
    );

    if (cReimb >= 0) {
      const amt = num(grid[r]?.[cReimb]);
      const label = text(grid[r]?.[cReimb + 1]);
      // Imported as unsettled: the sheet records the money that actually moved in
      // its transfer rows, so marking these paid too would double-count.
      // Sheets keep the USD figure next to its label and the PKR conversion on
      // the following row; only the labelled USD row is a real reimbursement.
      if (amt > 0 && label && !Number.isFinite(Number(label)))
        period.reimbursements.push({ id: uid(), label, amountUsd: amt, settled: false });
    }
  }

  // Division matrix: the row that holds "Name" + "Pay" plus account columns.
  let dr = -1;
  for (let r = hr; r < grid.length; r++) {
    const cells = (grid[r] || []).map((c) => norm(text(c)));
    if (cells.includes('name') && cells.includes('pay')) { dr = r; break; }
  }
  if (dr >= 0) {
    const D = grid[dr];
    const colToAccount: Record<number, string> = {};
    for (let c = 0; c < D.length; c++) {
      const head = text(D[c]);
      if (!head || norm(head) === 'name' || norm(head) === 'pay') continue;
      const match =
        period.accounts.find((a) => norm(a.name) === norm(head)) ||
        period.accounts.find((a) => norm(a.name).includes(norm(head)) || norm(head).includes(norm(a.name)));
      if (match) colToAccount[c] = match.id;
    }
    for (let r = dr + 1; r < grid.length; r++) {
      const name = text(grid[r]?.[0]);
      if (!name) break;
      const shares: Record<string, number> = {};
      for (const [c, accId] of Object.entries(colToAccount)) {
        const v = num(grid[r]?.[Number(c)]);
        if (v) shares[accId] = v;
      }
      period.staff.push(newStaff({ name, shares }));
    }
  }

  // Transfers already made, wherever they are labelled.
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r] || []).length; c++) {
      const t = norm(text(grid[r][c]));
      if (t === 'transferedpriorly' || t === 'transferredpriorly' || t === 'transferred') {
        const amount = num(grid[r][c + 1]);
        if (amount > 0)
          period.transfers.push({ id: uid(), label: 'Transferred priorly', amountPkr: amount, date: '' });
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
      ['Account', 'Owner', 'Mode', 'Rate', 'Units', 'Gross USD', 'Fee %', 'Fee USD', 'Adjustment USD', 'Earned USD', 'Earned PKR', 'Freelancer %', 'Freelancer USD', 'Freelancer PKR', 'Company USD', 'Company PKR', 'Status', 'Notes'],
    ];
    for (const a of res.accounts) {
      rows.push([
        a.account.name, a.account.owner, a.account.mode, a.account.rate, a.units, a.grossUsd,
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
    rows.push(['Label', 'USD', 'PKR', 'Settled']);
    for (const r of p.reimbursements)
      rows.push([r.label, r.amountUsd, round2(r.amountUsd * p.usdToPkr), r.settled ? 'Yes' : 'No']);

    rows.push([], ['Ledger (PKR)']);
    rows.push(['Staff pay', res.totals.staffPayPkr]);
    rows.push(['Company share', res.totals.companyPkr]);
    rows.push(['Reimbursements', res.ledger.reimbursementsPkr]);
    rows.push(['Transferable', res.ledger.transferablePkr]);
    for (const t of p.transfers) rows.push([`Transferred — ${t.label}${t.date ? ` (${t.date})` : ''}`, t.amountPkr]);
    rows.push(['Transferred total', res.ledger.transferredPkr]);
    rows.push(['Remaining', res.ledger.remainingPkr]);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = rows[0].map(() => ({ wch: 16 }));
    XLSX.utils.book_append_sheet(wb, ws, p.label.slice(0, 31) || 'Period');
  }

  const sws = XLSX.utils.aoa_to_sheet(summary);
  sws['!cols'] = summary[0].map(() => ({ wch: 16 }));
  XLSX.utils.book_append_sheet(wb, sws, 'Summary');
  XLSX.writeFile(wb, filename);
}

/** Per-person payout sheet for the active period — what actually gets paid out. */
export function exportPayoutSheet(period: Period) {
  const res = computePeriod(period);
  const rows: (string | number)[][] = [
    [`Payout register — ${period.label}`],
    [`USD→PKR ${period.usdToPkr}`],
    [],
    ['Name', 'Pay PKR', 'Pay USD', 'Breakdown'],
  ];
  for (const s of res.staff) {
    const detail = Object.entries(s.byAccount)
      .map(([id, v]) => `${period.accounts.find((a) => a.id === id)?.name ?? id}: ${Math.round(v).toLocaleString()}`)
      .join('; ');
    rows.push([s.staff.name, s.payPkr, s.payUsd, detail]);
  }
  rows.push(['TOTAL', res.totals.staffPayPkr, round2(res.totals.staffPayPkr / (period.usdToPkr || 1)), '']);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 70 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Payouts');
  XLSX.writeFile(wb, `Payouts - ${period.label}.xlsx`);
}

export type { Account, StaffMember };
