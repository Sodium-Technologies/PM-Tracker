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
  /** of what they took, the part that is an advance on this month's pay */
  advanceAgainstPayPkr: number;
  /** of what they took, the part beyond this month's pay — a true draw */
  drawPkr: number;
  /** pay not yet in their hands: what is still owed after the advance */
  stillOwedPkr: number;
  /** what this person costs the local pot: their pay if it is settled here,
   *  otherwise only what they have taken, plus any draw either way */
  paidHerePkr: number;
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
    /** everything owed this period: team pay + other people + company share.
     *  What the month is worth — not what has arrived. */
    transferablePkr: number;
    /** money that has actually come in: accounts marked received, less any the
     *  client paid straight into the company's account */
    receivedPkr: number;
    /** money from clients who pay the company directly — never passes through
     *  the person keeping the books, so it is not theirs to send on */
    directPkr: number;
    reimbursementsPkr: number;
    /** pay of people whose wages are handed over locally */
    retainedPkr: number;
    /** advances: money taken against pay already earned this month */
    advancesPkr: number;
    /** money taken beyond the pay earned this month */
    drawsPkr: number;
    /** everything settled here: pay handed over locally, advances, draws, and
     *  any other wage paid on this side */
    localWagesPkr: number;
    withheldPkr: number;
    transfersPkr: number;
    /** what is left to send */
    remainingPkr: number;
  };
  warnings: string[];
}

/** A client has paid when the account says so. The status is free text, so it
 *  is matched the same way everywhere. */
export const isReceived = (status: string) => /received/i.test(status || '');

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
    // Money taken comes off this month's pay first. Only what is left over once
    // the pay is used up is a draw — taking PKR 50,000 against PKR 80,000 of pay
    // is an advance, and the remaining PKR 30,000 is still owed.
    const taken = Math.max(0, Number(s.advancePkr) || 0);
    const earned = Math.max(0, payPkr);
    let advanceAgainstPayPkr = Math.min(taken, earned);
    let drawPkr = taken - advanceAgainstPayPkr;
    // Taking exactly the month's pay leaves a sub-rupee residue behind, and a
    // fraction of a rupee is not a draw. Fold anything that rounds to nothing
    // back into the advance, so the two always add up to what was taken.
    if (Math.round(drawPkr) === 0) {
      advanceAgainstPayPkr = taken;
      drawPkr = 0;
    }
    // Somebody paid here has their whole pay handed over locally, so an advance
    // is part of that, not on top of it.
    const paidHerePkr = (s.retained ? earned : advanceAgainstPayPkr) + drawPkr;
    return {
      staff: s,
      byAccount,
      sharePkr,
      payPkr,
      payUsd: rate ? payPkr / rate : 0,
      advanceAgainstPayPkr,
      drawPkr,
      stillOwedPkr: payPkr - advanceAgainstPayPkr,
      paidHerePkr,
    };
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
  const advancesPkr = sum(staff.map((s) => s.advanceAgainstPayPkr));
  const drawsPkr = sum(staff.map((s) => s.drawPkr));
  // Wages handed over where the books are kept: what each person has actually
  // had on this side — their whole pay if it is settled here, otherwise just
  // what they have taken — plus any other wage paid here by hand.
  const localWagesPkr =
    sum(staff.map((s) => s.paidHerePkr)) + sum(period.localWages.map((x) => x.amountPkr));
  // Clients who pay the company's account directly: the whole amount — the
  // team's part and the company's part — is already where it needs to be.
  const directPkr = sum(accounts.filter((a) => a.account.paidDirect).map((a) => a.earnedPkr));

  // Everything the month is worth, whether or not a client has paid yet.
  const transferablePkr = t.staffPayPkr + otherPayablesPkr + t.companyPkr;
  // Only money in hand can be sent on. An account the client paid straight into
  // the company's account never reaches the person keeping the books, so it is
  // not part of what they hold either.
  const receivedPkr = sum(
    accounts
      .filter((a) => isReceived(a.account.status) && !a.account.paidDirect)
      .map((a) => a.earnedPkr),
  );
  // What is left to send is the money in hand, less every rupee of it that has
  // already gone somewhere: handed over here (a wage paid locally), spent on
  // that side, held back, or already transferred.
  const remainingPkr = receivedPkr - reimbursementsPkr - localWagesPkr - withheldPkr - transfersPkr;

  const warnings: string[] = [];
  if (!rate) warnings.push('The USD to PKR rate for this month has not been set.');
  // Money went out, but no client is marked as having paid: the balance below
  // is counting against nothing, and the statuses are what need fixing.
  if (transfersPkr > 0 && receivedPkr === 0 && t.earnedPkr > 0) {
    warnings.push(
      'Money has already been sent this month, but no client is marked as received — '
      + 'tick Received on the Revenue tab for the ones who have paid, or "Left to send" '
      + 'will read as an overdraft.',
    );
  }
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
  for (const s of staff) {
    if (s.drawPkr > 0) {
      warnings.push(
        `${s.staff.name} has taken ${fmtPkr(s.staff.advancePkr)} but earned `
        + `${fmtPkr(s.payPkr)} this month — ${fmtPkr(s.drawPkr)} of it is a draw, `
        + 'not salary.',
      );
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
      receivedPkr,
      directPkr,
      reimbursementsPkr,
      retainedPkr,
      advancesPkr,
      drawsPkr,
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
