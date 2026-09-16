import type { Account, Period, StaffMember } from './types';

export const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface AccountResult {
  account: Account;
  units: number;
  grossUsd: number;
  feeUsd: number;
  earnedUsd: number;
  earnedPkr: number;
  freelancerUsd: number;
  freelancerPkr: number;
  companyUsd: number;
  companyPkr: number;
  /** total of all staff shares on this account; 1 means fully allocated */
  allocated: number;
}

export function computeAccount(account: Account, staff: StaffMember[], usdToPkr: number): AccountResult {
  const units = sum(account.entries);
  // All of the arithmetic happens in the account's own currency, then converts
  // once — an account settled in PKR never depends on the conversion rate.
  const gross = round2(account.rate * units);
  const fee = round2(gross * (account.feePct / 100));
  const earned = round2(gross - fee + (Number(account.adjustmentUsd) || 0));
  const inPkr = account.currency === 'PKR';
  const toUsd = (v: number) => (inPkr ? (usdToPkr ? round2(v / usdToPkr) : 0) : v);
  const toPkr = (v: number) => (inPkr ? v : round2(v * usdToPkr));

  const earnedUsd = toUsd(earned);
  const freelancerUsd = round2(earnedUsd * (account.freelancerPct / 100));
  const freelancerPkr = round2(toPkr(earned) * (account.freelancerPct / 100));
  const allocated = sum(staff.map((s) => s.shares[account.id] || 0));
  return {
    account,
    units,
    grossUsd: toUsd(gross),
    feeUsd: toUsd(fee),
    earnedUsd,
    earnedPkr: toPkr(earned),
    freelancerUsd,
    freelancerPkr,
    companyUsd: round2(earnedUsd - freelancerUsd),
    companyPkr: round2(toPkr(earned) - freelancerPkr),
    allocated,
  };
}

export interface StaffResult {
  staff: StaffMember;
  /** accountId -> PKR earned from that account */
  byAccount: Record<string, number>;
  /** pay from the division matrix, before the manual adjustment */
  sharePkr: number;
  payPkr: number;
  payUsd: number;
}

export interface PeriodResult {
  accounts: AccountResult[];
  staff: StaffResult[];
  totals: {
    grossUsd: number;
    feeUsd: number;
    earnedUsd: number;
    earnedPkr: number;
    freelancerUsd: number;
    freelancerPkr: number;
    companyUsd: number;
    companyPkr: number;
    staffPayPkr: number;
    /** freelancer pool left unassigned because staff shares don't add to 100% */
    unallocatedPkr: number;
  };
  ledger: {
    otherPayablesPkr: number;
    /** everything owed this period: staff pay + outside payables + company share */
    transferablePkr: number;
    reimbursementsPkr: number;
    /** pay of people whose wages are settled locally */
    retainedPkr: number;
    /** retained pay plus the drawn wage lines: everything paid out on the spot */
    localWagesPkr: number;
    withheldPkr: number;
    transfersPkr: number;
    /** what still has to be remitted */
    remainingPkr: number;
  };
  warnings: string[];
}

export function computePeriod(period: Period): PeriodResult {
  const rate = Number(period.usdToPkr) || 0;
  const accounts = period.accounts.map((a) => computeAccount(a, period.staff, rate));

  const staff: StaffResult[] = period.staff.map((s) => {
    const byAccount: Record<string, number> = {};
    let sharePkr = 0;
    for (const ar of accounts) {
      const share = Number(s.shares[ar.account.id]) || 0;
      const amount = round2(ar.freelancerPkr * share);
      if (amount) byAccount[ar.account.id] = amount;
      sharePkr += amount;
    }
    sharePkr = round2(sharePkr);
    const payPkr = round2(sharePkr + (Number(s.adjustmentPkr) || 0));
    return { staff: s, byAccount, sharePkr, payPkr, payUsd: rate ? round2(payPkr / rate) : 0 };
  });

  const t = {
    grossUsd: round2(sum(accounts.map((a) => a.grossUsd))),
    feeUsd: round2(sum(accounts.map((a) => a.feeUsd))),
    earnedUsd: round2(sum(accounts.map((a) => a.earnedUsd))),
    earnedPkr: round2(sum(accounts.map((a) => a.earnedPkr))),
    freelancerUsd: round2(sum(accounts.map((a) => a.freelancerUsd))),
    freelancerPkr: round2(sum(accounts.map((a) => a.freelancerPkr))),
    companyUsd: round2(sum(accounts.map((a) => a.companyUsd))),
    companyPkr: round2(sum(accounts.map((a) => a.companyPkr))),
    staffPayPkr: round2(sum(staff.map((s) => s.payPkr))),
    unallocatedPkr: 0,
  };
  t.unallocatedPkr = round2(t.freelancerPkr - round2(sum(staff.map((x) => x.sharePkr))));

  const otherPayablesPkr = round2(sum(period.otherPayables.map((x) => x.amountPkr)));
  const withheldPkr = round2(sum(period.withheld.map((x) => x.amountPkr)));
  const transfersPkr = round2(sum(period.transfers.map((x) => x.amountPkr)));
  const reimbursementsPkr = round2(sum(period.reimbursements.map((r) => r.amountUsd)) * rate);
  const retainedPkr = round2(sum(staff.filter((s) => s.staff.retained).map((s) => s.payPkr)));
  // Wages handed over where the books are kept: the pay of people marked as
  // settled locally, plus any amount drawn on top (a salary, an extra share).
  const localWagesPkr = round2(retainedPkr + sum(period.localWages.map((x) => x.amountPkr)));

  // Everything owed for the period …
  const transferablePkr = round2(t.staffPayPkr + otherPayablesPkr + t.companyPkr);
  // … less what never has to travel: expenses already covered on the receiving
  // side, pay that stays put, amounts held back, and money already sent.
  const remainingPkr = round2(
    transferablePkr - reimbursementsPkr - localWagesPkr - withheldPkr - transfersPkr,
  );

  const warnings: string[] = [];
  if (!rate) warnings.push('USD→PKR conversion rate is not set for this period.');
  for (const ar of accounts) {
    const pct = round2(ar.allocated * 100);
    if (ar.earnedUsd !== 0 && pct !== 100) {
      warnings.push(
        `${ar.account.name}: staff shares total ${pct}% (should be 100%) — ` +
          `${round2(ar.freelancerPkr * (1 - ar.allocated)).toLocaleString()} PKR unassigned.`,
      );
    }
  }
  if (period.accounts.some((a) => a.freelancerPct < 0 || a.freelancerPct > 100))
    warnings.push('An account has a freelancer split outside 0–100%.');

  return {
    accounts,
    staff,
    totals: t,
    ledger: {
      otherPayablesPkr,
      transferablePkr,
      reimbursementsPkr,
      retainedPkr,
      localWagesPkr,
      withheldPkr,
      transfersPkr,
      remainingPkr,
    },
    warnings,
  };
}

export const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export const fmtPkr = (n: number) =>
  'PKR ' + Math.round(n).toLocaleString('en-US');
export const fmtNum = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 });
