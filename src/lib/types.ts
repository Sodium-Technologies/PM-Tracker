/** Core data model. Everything is dynamic: periods, accounts, staff and splits
 *  are all user-defined at runtime — nothing about the roster is hard-coded. */

export type BillingMode = 'hourly' | 'fixed';
export type Currency = 'USD' | 'PKR';

export interface Account {
  id: string;
  /** Client / project name, e.g. "Luxe", "DET Homes". */
  name: string;
  /** Who owns the account internally (the mastersheet "Account" column). */
  owner: string;
  mode: BillingMode;
  /** Currency the rate and adjustments are stated in. Most accounts bill in USD;
   *  some are settled directly in PKR and never touch a conversion. */
  currency: Currency;
  /** Rate per hour (hourly) or per unit/month (fixed), in `currency`. */
  rate: number;
  /** Individual time entries (weeks, invoices, units). Summed to get hours/units. */
  entries: number[];
  /** Platform/agency fee withheld from gross, as a percentage (e.g. 1, 10, 15). */
  feePct: number;
  /** Free-form correction applied after the fee, in `currency`
   *  (refunds, bonuses, true-ups). */
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
  /** Manual PKR correction on this person's pay (settling something between two
   *  people, a deduction agreed off-sheet). Can be negative. */
  adjustmentPkr: number;
  /** Pay that stays where it is instead of being remitted — it is still owed to
   *  the person, but it is not part of the money that has to be sent. */
  retained: boolean;
  notes: string;
}

/** Expenses already paid from the receiving side (subscriptions, advances).
 *  They reduce what still has to be remitted. */
export interface Reimbursement {
  id: string;
  label: string;
  amountUsd: number;
}

/** A free-form PKR line: money owed on top of the division (otherPayables),
 *  or money deliberately held back this period (withheld). */
export interface LineItem {
  id: string;
  label: string;
  amountPkr: number;
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
  /** Payables outside the division matrix (e.g. an outside contractor). */
  otherPayables: LineItem[];
  /** Amounts kept back this period rather than remitted. */
  withheld: LineItem[];
  transfers: Transfer[];
}

export interface AppState {
  version: 1;
  activePeriodId: string;
  periods: Period[];
}

export const STATUS_OPTIONS = ['Pending', 'Invoiced', 'Received', 'Not Received', 'On Hold'];
