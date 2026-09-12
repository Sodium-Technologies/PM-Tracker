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
  const grossUsd = round2(account.rate * units);
  const feeUsd = round2(grossUsd * (account.feePct / 100));
  const earnedUsd = round2(grossUsd - feeUsd + (Number(account.adjustmentUsd) || 0));
  const freelancerUsd = round2(earnedUsd * (account.freelancerPct / 100));
  const companyUsd = round2(earnedUsd - freelancerUsd);
  const allocated = sum(staff.map((s) => s.shares[account.id] || 0));
  return {
    account,
    units,
    grossUsd,
    feeUsd,
    earnedUsd,
    earnedPkr: round2(earnedUsd * usdToPkr),
    freelancerUsd,
    freelancerPkr: round2(freelancerUsd * usdToPkr),
    companyUsd,
    companyPkr: round2(companyUsd * usdToPkr),
    allocated,
  };
}

export interface StaffResult {
  staff: StaffMember;
  /** accountId -> PKR earned from that account */
  byAccount: Record<string, number>;
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
    reimbursementsPkr: number;
    settledReimbursementsPkr: number;
    transferablePkr: number;
    transferredPkr: number;
    remainingPkr: number;
  };
  warnings: string[];
}

export function computePeriod(period: Period): PeriodResult {
  const rate = Number(period.usdToPkr) || 0;
  const accounts = period.accounts.map((a) => computeAccount(a, period.staff, rate));

  const staff: StaffResult[] = period.staff.map((s) => {
    const byAccount: Record<string, number> = {};
    let payPkr = 0;
    for (const ar of accounts) {
      const share = Number(s.shares[ar.account.id]) || 0;
      const amount = round2(ar.freelancerPkr * share);
      if (amount) byAccount[ar.account.id] = amount;
      payPkr += amount;
    }
    payPkr = round2(payPkr);
    return { staff: s, byAccount, payPkr, payUsd: rate ? round2(payPkr / rate) : 0 };
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
  t.unallocatedPkr = round2(t.freelancerPkr - t.staffPayPkr);

  const reimbursementsPkr = round2(sum(period.reimbursements.map((r) => r.amountUsd)) * rate);
  const settledReimbursementsPkr = round2(
    sum(period.reimbursements.filter((r) => r.settled).map((r) => r.amountUsd)) * rate,
  );
  const transferablePkr = round2(t.staffPayPkr + t.companyPkr + reimbursementsPkr);
  const transferredPkr = round2(sum(period.transfers.map((x) => x.amountPkr)) + settledReimbursementsPkr);

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
      reimbursementsPkr,
      settledReimbursementsPkr,
      transferablePkr,
      transferredPkr,
      remainingPkr: round2(transferablePkr - transferredPkr),
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
