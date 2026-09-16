/** Core data model. Everything is dynamic: periods, accounts, staff and splits
 *  are all user-defined at runtime — nothing about the roster is hard-coded. */

export type Currency = 'USD' | 'PKR';

export interface Account {
  id: string;
  /** Client / project name, e.g. "Luxe", "DET Homes". */
  name: string;
  /** Who owns the account internally (the mastersheet "Account" column). */
  owner: string;
  /** Currency the rate and adjustments are stated in. Most accounts bill in USD;
   *  some are settled directly in PKR and never touch a conversion. */
  currency: Currency;
  /** Rate per unit of work — an hour, a lease, a month — in `currency`.
   *  A fixed amount is simply a rate with a single unit. */
  rate: number;
  /** Individual time entries (weeks, invoices, units). Summed to get hours/units. */
  entries: number[];
  /** Fee deduction withheld from gross, as a percentage (e.g. 1, 10, 15).
   *  Mirrors the "Fee Deduction" column in the mastersheet, which holds it as a
   *  fraction (0.15). */
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
  /** This person's pay is settled where the books are kept, not remitted — the
   *  administrator hands it over locally. It is still pay, and still recorded;
   *  it simply never travels. */
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
  /** Wages drawn where the books are kept — a salary, a share taken in person,
   *  a top-up. Recorded as paid, and deducted from what must be remitted. */
  localWages: LineItem[];
  transfers: Transfer[];
}

export interface AppState {
  version: 1;
  activePeriodId: string;
  periods: Period[];
}

export const STATUS_OPTIONS = ['Pending', 'Invoiced', 'Received', 'Not Received', 'On Hold'];
