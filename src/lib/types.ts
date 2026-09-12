/** Core data model. Everything is dynamic: periods, accounts, staff and splits
 *  are all user-defined at runtime — nothing about the roster is hard-coded. */

export type BillingMode = 'hourly' | 'fixed';

export interface Account {
  id: string;
  /** Client / project name, e.g. "Luxe", "DET Homes". */
  name: string;
  /** Who owns the account internally (the mastersheet "Account" column). */
  owner: string;
  mode: BillingMode;
  /** USD per hour (hourly) or USD per unit/month (fixed). */
  rate: number;
  /** Individual time entries (weeks, invoices, units). Summed to get hours/units. */
  entries: number[];
  /** Platform/agency fee withheld from gross, as a percentage (e.g. 1, 10, 15). */
  feePct: number;
  /** Free-form USD correction applied after the fee (refunds, bonuses, true-ups). */
  adjustmentUsd: number;
  /** Percentage of net revenue paid out to the freelancer pool (rest is company). */
  freelancerPct: number;
  status: string;
  notes: string;
}

export interface StaffMember {
  id: string;
  name: string;
  /** accountId -> share of that account's freelancer pool, 0..1 */
  shares: Record<string, number>;
  notes: string;
}

export interface Reimbursement {
  id: string;
  label: string;
  amountUsd: number;
  /** true when the money was already sent out and should reduce what is left to send. */
  settled: boolean;
}

export interface Transfer {
  id: string;
  label: string;
  amountPkr: number;
  date: string;
}

export interface Period {
  id: string;
  /** e.g. "August 2026" */
  label: string;
  usdToPkr: number;
  accounts: Account[];
  staff: StaffMember[];
  reimbursements: Reimbursement[];
  transfers: Transfer[];
}

export interface AppState {
  version: 1;
  activePeriodId: string;
  periods: Period[];
}

export const STATUS_OPTIONS = ['Pending', 'Invoiced', 'Received', 'Not Received', 'On Hold'];
