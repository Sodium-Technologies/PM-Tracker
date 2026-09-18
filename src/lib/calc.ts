import type { Account, Period, StaffMember } from './types';
import { entriesToHours, entryProblems, type TimeFormat } from './time';

export const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number(b) || 0), 0);

/** Rounding is for showing a number, never for working one out: a figure
 *  rounded mid-calculation carries its error into every total built on it.
 *  Everything below keeps full precision; the formatters at the bottom round
 *  once, at the moment a person reads it. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface AccountResult {
  account: Account;
  /** time on this account, in hours */
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

export function computeAccount(
  account: Account,
  staff: StaffMember[],
  usdToPkr: number,
  timeFormat: TimeFormat,
): AccountResult {
  const units = entriesToHours(account.entries, timeFormat);
  // All of the arithmetic happens in the account's own currency, then converts
  // once — an account settled in PKR never depends on the conversion rate.
  const gross = account.rate * units;
  const fee = gross * (account.feePct / 100);
  const earned = gross - fee + (Number(account.adjustmentUsd) || 0);
  const inPkr = account.currency === 'PKR';
  const toUsd = (v: number) => (inPkr ? (usdToPkr ? v / usdToPkr : 0) : v);
  const toPkr = (v: number) => (inPkr ? v : v * usdToPkr);

  const earnedUsd = toUsd(earned);
  const freelancerUsd = earnedUsd * (account.freelancerPct / 100);
  const freelancerPkr = toPkr(earned) * (account.freelancerPct / 100);
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
    companyUsd: earnedUsd - freelancerUsd,
    companyPkr: toPkr(earned) - freelancerPkr,
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
    /** team money left unassigned because the shares don't add to 100% */
    unallocatedPkr: number;
  };
  ledger: {
    otherPayablesPkr: number;
    /** everything owed this period: team pay + other people + company share */
    transferablePkr: number;
    /** money from clients who pay the company directly — never passes through
     *  the person keeping the books, so it is not theirs to send on */
    directPkr: number;
    reimbursementsPkr: number;
    /** pay of people whose wages are handed over locally */
    retainedPkr: number;
    /** retained pay plus anything drawn on top */
    localWagesPkr: number;
    withheldPkr: number;
    transfersPkr: number;
    /** what is left to send */
    remainingPkr: number;
  };
  warnings: string[];
}

export function computePeriod(period: Period): PeriodResult {
  const rate = Number(period.usdToPkr) || 0;
  const timeFormat: TimeFormat = period.timeFormat ?? 'decimal';
  const accounts = period.accounts.map((a) => computeAccount(a, period.staff, rate, timeFormat));

  const staff: StaffResult[] = period.staff.map((s) => {
    const byAccount: Record<string, number> = {};
    let sharePkr = 0;
    for (const ar of accounts) {
      const share = Number(s.shares[ar.account.id]) || 0;
      const amount = ar.freelancerPkr * share;
      if (amount) byAccount[ar.account.id] = amount;
      sharePkr += amount;
    }
    const payPkr = sharePkr + (Number(s.adjustmentPkr) || 0);
    return { staff: s, byAccount, sharePkr, payPkr, payUsd: rate ? payPkr / rate : 0 };
  });

  const t = {
    grossUsd: sum(accounts.map((a) => a.grossUsd)),
    feeUsd: sum(accounts.map((a) => a.feeUsd)),
    earnedUsd: sum(accounts.map((a) => a.earnedUsd)),
    earnedPkr: sum(accounts.map((a) => a.earnedPkr)),
    freelancerUsd: sum(accounts.map((a) => a.freelancerUsd)),
    freelancerPkr: sum(accounts.map((a) => a.freelancerPkr)),
    companyUsd: sum(accounts.map((a) => a.companyUsd)),
    companyPkr: sum(accounts.map((a) => a.companyPkr)),
    staffPayPkr: sum(staff.map((s) => s.payPkr)),
    unallocatedPkr: 0,
  };
  t.unallocatedPkr = t.freelancerPkr - sum(staff.map((x) => x.sharePkr));

  const otherPayablesPkr = sum(period.otherPayables.map((x) => x.amountPkr));
  const withheldPkr = sum(period.withheld.map((x) => x.amountPkr));
  const transfersPkr = sum(period.transfers.map((x) => x.amountPkr));
  const reimbursementsPkr = sum(period.reimbursements.map((r) => r.amountUsd)) * rate;
  const retainedPkr = sum(staff.filter((s) => s.staff.retained).map((s) => s.payPkr));
  // Wages handed over where the books are kept: the pay of people marked as
  // settled locally, plus any amount drawn on top (a salary, an extra share).
  const localWagesPkr = retainedPkr + sum(period.localWages.map((x) => x.amountPkr));
  // Clients who pay the company's account directly: the whole amount — the
  // team's part and the company's part — is already where it needs to be.
  const directPkr = sum(accounts.filter((a) => a.account.paidDirect).map((a) => a.earnedPkr));

  // Everything owed for the period …
  const transferablePkr = t.staffPayPkr + otherPayablesPkr + t.companyPkr;
  // … less every reason a rupee of it does not have to be sent.
  const remainingPkr =
    transferablePkr - directPkr - reimbursementsPkr - localWagesPkr - withheldPkr - transfersPkr;

  const warnings: string[] = [];
  if (!rate) warnings.push('The USD to PKR rate for this month has not been set.');
  for (const ar of accounts) {
    const pct = round2(ar.allocated * 100);
    if (ar.earnedUsd !== 0 && pct !== 100) {
      warnings.push(
        `${ar.account.name}: the shares add up to ${pct}%, not 100% — `
        + `PKR ${Math.round(ar.freelancerPkr * (1 - ar.allocated)).toLocaleString()} is not going to anyone.`,
      );
    }
    for (const problem of entryProblems(ar.account.entries, timeFormat)) {
      warnings.push(`${ar.account.name}: a time entry reads ${problem}`);
    }
  }
  if (period.accounts.some((a) => a.freelancerPct < 0 || a.freelancerPct > 100))
    warnings.push('An account gives the team less than 0% or more than 100%.');

  return {
    accounts,
    staff,
    totals: t,
    ledger: {
      otherPayablesPkr,
      transferablePkr,
      directPkr,
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

/** A figure that rounds away to nothing is nothing: without this, a balance of
 *  −0.3 PKR prints as "PKR -0", and −0.004 USD as "-$0.00". Nobody is owed a
 *  negative zero. `digits` is what the formatter will show. */
const noNegativeZero = (n: number, digits: number) => {
  const scale = 10 ** digits;
  return Math.round(n * scale) === 0 ? 0 : n;
};

export const fmtUsd = (n: number) =>
  noNegativeZero(n, 2).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export const fmtPkr = (n: number) =>
  'PKR ' + Math.round(noNegativeZero(n, 0)).toLocaleString('en-US');
/** True only when the figure reads negative once printed, so a balance that
 *  shows as PKR 0 is never styled as an overdraft. */
export const negativePkr = (n: number) => Math.round(noNegativeZero(n, 0)) < 0;
export const fmtNum = (n: number) =>
  noNegativeZero(n, 2).toLocaleString('en-US', { maximumFractionDigits: 2 });
