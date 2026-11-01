import React from 'react';
import type { Currency } from './types';
import { supabase } from './supabase';
import { uid } from './state';

/** Loans are a ledger of their own. They belong to no month, take no part in
 *  any month's figures, and are kept apart from the books in every way: their
 *  own table, their own storage, not in the backup or the Excel download. */

/** Money moving out and coming back — or in, and going back. */
export type LoanDirection = 'lent' | 'borrowed';

export interface Repayment {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** in the loan's currency */
  amount: number;
  note: string;
}

export interface Loan {
  id: string;
  /** who the money went to, or came from */
  who: string;
  /** `lent`: they owe you. `borrowed`: you owe them. */
  direction: LoanDirection;
  currency: Currency;
  amount: number;
  /** `YYYY-MM-DD` */
  date: string;
  note: string;
  repayments: Repayment[];
}

export type LoanStatus = 'open' | 'repaid' | 'overpaid';

export interface LoanResult {
  loan: Loan;
  repaid: number;
  /** what is still to come back (or still to pay back) */
  balance: number;
  status: LoanStatus;
}

/** Below a cent (or a rupee's hundredth) a balance is settled, not open. */
const settled = (n: number) => Math.abs(n) < 0.005;

export function computeLoan(loan: Loan): LoanResult {
  const repaid = loan.repayments.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const balance = (Number(loan.amount) || 0) - repaid;
  return {
    loan, repaid, balance,
    status: settled(balance) ? 'repaid' : balance < 0 ? 'overpaid' : 'open',
  };
}

export interface LoanTotals {
  /** still owed to you, per currency */
  owedToYou: Record<Currency, number>;
  /** still owed by you, per currency */
  youOwe: Record<Currency, number>;
  /** repaid so far across every loan, per currency */
  repaid: Record<Currency, number>;
  open: number;
}

const zero = (): Record<Currency, number> => ({ USD: 0, PKR: 0 });

/** Totals are kept per currency: rupees and dollars are never added together. */
export function loanTotals(loans: Loan[]): LoanTotals {
  const t: LoanTotals = { owedToYou: zero(), youOwe: zero(), repaid: zero(), open: 0 };
  for (const r of loans.map(computeLoan)) {
    const c = r.loan.currency;
    t.repaid[c] += r.repaid;
    if (r.status !== 'open') continue;
    t.open++;
    if (r.loan.direction === 'lent') t.owedToYou[c] += r.balance;
    else t.youOwe[c] += r.balance;
  }
  return t;
}

/** Where things stand with each person: what they owe you less what you owe
 *  them, per currency. Positive means they owe you. */
export function byPerson(loans: Loan[]): { who: string; net: Record<Currency, number>; open: number }[] {
  const by = new Map<string, { who: string; net: Record<Currency, number>; open: number }>();
  for (const r of loans.map(computeLoan)) {
    const key = r.loan.who.trim().toLowerCase() || '—';
    const at = by.get(key) ?? { who: r.loan.who.trim() || '—', net: zero(), open: 0 };
    at.net[r.loan.currency] += r.loan.direction === 'lent' ? r.balance : -r.balance;
    if (r.status === 'open') at.open++;
    by.set(key, at);
  }
  return [...by.values()]
    .filter((p) => !settled(p.net.PKR) || !settled(p.net.USD))
    .sort((a, b) => a.who.localeCompare(b.who));
}

export const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function newLoan(partial: Partial<Loan> = {}): Loan {
  return {
    id: uid(), who: '', direction: 'lent', currency: 'PKR', amount: 0,
    date: today(), note: '', repayments: [], ...partial,
  };
}

export const newRepayment = (partial: Partial<Repayment> = {}): Repayment =>
  ({ id: uid(), date: today(), amount: 0, note: '', ...partial });

/** Fill in anything an older save predates. */
function normalizeLoan(raw: Partial<Loan> & { id: string }): Loan {
  return {
    ...newLoan(),
    ...raw,
    direction: raw.direction === 'borrowed' ? 'borrowed' : 'lent',
    currency: raw.currency === 'USD' ? 'USD' : 'PKR',
    repayments: Array.isArray(raw.repayments) ? raw.repayments : [],
  };
}

/* ---------------------------------------------------------------- storage */

const LOCAL_KEY = 'pm-payroll-loans-v1';

/** True when the project has not been given the loans table yet. */
export const missingTable = (message?: string) =>
  !!message && /pm_loans/i.test(message) && /does not exist|schema cache|not find/i.test(message);

export const SETUP_NOTE = 'Loans need one addition to the database first: run supabase/loans.sql in '
  + 'Supabase → SQL Editor. It only adds the loans table — nothing else changes.';

function readLocal(): Loan[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? (JSON.parse(raw) as Loan[]) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => l?.id).map(normalizeLoan) : [];
  } catch {
    return [];
  }
}

function writeLocal(loans: Loan[]) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(loans)); } catch { /* private mode */ }
}

async function fetchLoans(): Promise<{ loans: Loan[]; error?: string; missing?: boolean }> {
  if (!supabase) return { loans: readLocal() };
  const { data, error } = await supabase.from('pm_loans').select('id,data');
  if (error) return { loans: [], error: error.message, missing: missingTable(error.message) };
  return {
    loans: ((data as { id: string; data: Loan }[]) ?? [])
      .filter((r) => r.data)
      .map((r) => normalizeLoan({ ...r.data, id: r.id })),
  };
}

/** One row per loan. The owner is never sent: the database stamps it from
 *  the sign-in, so a loan cannot be filed under anybody else. */
async function saveLoan(loan: Loan): Promise<string | undefined> {
  if (!supabase) return undefined;
  const { error } = await supabase.from('pm_loans').upsert({ id: loan.id, data: loan }, { onConflict: 'id' });
  if (!error) return undefined;
  return missingTable(error.message) ? SETUP_NOTE : error.message;
}

async function deleteLoanRow(id: string): Promise<string | undefined> {
  if (!supabase) return undefined;
  const { error } = await supabase.from('pm_loans').delete().eq('id', id);
  return error?.message;
}

/** The loans ledger: read once, changed in place, written back a loan at a
 *  time — typing into a box saves once the typing stops, not per keystroke. */
export function useLoans() {
  const [loans, setLoans] = React.useState<Loan[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [missing, setMissing] = React.useState(false);
  const timers = React.useRef(new Map<string, number>());
  const latest = React.useRef<Loan[]>([]);

  React.useEffect(() => {
    let live = true;
    void fetchLoans().then((r) => {
      if (!live) return;
      setLoans(r.loans);
      latest.current = r.loans;
      setMissing(!!r.missing);
      setError(r.missing ? '' : r.error ?? '');
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const commit = (next: Loan[]) => {
    latest.current = next;
    setLoans(next);
    if (!supabase) writeLocal(next);
  };

  const persist = (id: string, wait: number) => {
    if (!supabase) return;
    window.clearTimeout(timers.current.get(id));
    timers.current.set(id, window.setTimeout(async () => {
      timers.current.delete(id);
      const loan = latest.current.find((l) => l.id === id);
      if (!loan) return;
      const failed = await saveLoan(loan);
      if (failed === SETUP_NOTE) setMissing(true);
      else if (failed) setError(failed);
      else { setError(''); setMissing(false); }
    }, wait));
  };

  return {
    loans, loading, error, missing,
    add(loan: Loan) {
      commit([...latest.current, loan]);
      persist(loan.id, 0);
    },
    update(id: string, fn: (l: Loan) => void) {
      commit(latest.current.map((l) => {
        if (l.id !== id) return l;
        const draft: Loan = JSON.parse(JSON.stringify(l));
        fn(draft);
        return draft;
      }));
      persist(id, 600);
    },
    async remove(id: string) {
      window.clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      commit(latest.current.filter((l) => l.id !== id));
      const failed = await deleteLoanRow(id);
      if (failed) setError(failed);
    },
  };
}

/* ---------------------------------------------------------------- download */

/** Loans as their own workbook — never part of the books' download. */
export async function exportLoans(loans: Loan[]) {
  const XLSX = await import('xlsx');
  const results = [...loans].sort((a, b) => a.date.localeCompare(b.date)).map(computeLoan);
  const loanRows: (string | number)[][] = [
    ['Date', 'Who', 'Type', 'Currency', 'Amount', 'Repaid', 'Balance', 'Status', 'Note'],
    ...results.map((r) => [
      r.loan.date, r.loan.who, r.loan.direction === 'lent' ? 'Lent — owed to me' : 'Borrowed — I owe',
      r.loan.currency, r.loan.amount, r.repaid, r.balance, r.status, r.loan.note,
    ]),
  ];
  const repaymentRows: (string | number)[][] = [
    ['Date', 'Who', 'Loan of', 'Currency', 'Repaid', 'Note'],
    ...results.flatMap((r) => [...r.loan.repayments]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => [p.date, r.loan.who, `${r.loan.amount} on ${r.loan.date}`, r.loan.currency, p.amount, p.note])),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(loanRows), 'Loans');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(repaymentRows), 'Repayments');
  XLSX.writeFile(wb, 'Loans.xlsx');
}
