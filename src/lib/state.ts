import type { Account, AppState, Period, StaffMember } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

const STORAGE_KEY = 'pm-payroll-state-v1';

export function newAccount(partial: Partial<Account> = {}): Account {
  return {
    id: uid(),
    name: 'New account',
    owner: '',
    mode: 'hourly',
    rate: 0,
    entries: [0],
    feePct: 0,
    adjustmentUsd: 0,
    freelancerPct: 70,
    status: 'Pending',
    notes: '',
    ...partial,
  };
}

export function newStaff(partial: Partial<StaffMember> = {}): StaffMember {
  return { id: uid(), name: 'New member', shares: {}, notes: '', ...partial };
}

export function newPeriod(label: string, usdToPkr = 280): Period {
  return { id: uid(), label, usdToPkr, accounts: [], staff: [], reimbursements: [], transfers: [] };
}

/** Next month label after e.g. "August 2026". Falls back to a generic label. */
export function nextLabel(label: string): string {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const m = label.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return `${label} (copy)`;
  const i = months.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  if (i < 0) return `${label} (copy)`;
  const year = Number(m[2]) + (i === 11 ? 1 : 0);
  return `${months[(i + 1) % 12]} ${year}`;
}

/** Clone a period forward: keeps accounts, staff and every split, clears the
 *  variable inputs (time entries, one-off adjustments, transfers). */
export function rollForward(period: Period, label?: string): Period {
  const idMap: Record<string, string> = {};
  const accounts = period.accounts.map((a) => {
    const id = uid();
    idMap[a.id] = id;
    return { ...a, id, entries: [0], adjustmentUsd: 0, status: 'Pending', notes: '' };
  });
  const staff = period.staff.map((s) => {
    const shares: Record<string, number> = {};
    for (const [oldId, v] of Object.entries(s.shares)) if (idMap[oldId]) shares[idMap[oldId]] = v;
    return { ...s, id: uid(), shares };
  });
  return {
    id: uid(),
    label: label || nextLabel(period.label),
    usdToPkr: period.usdToPkr,
    accounts,
    staff,
    reimbursements: period.reimbursements.map((r) => ({ ...r, id: uid(), settled: false })),
    transfers: [],
  };
}

export function emptyState(): AppState {
  const p = newPeriod(defaultLabel());
  return { version: 1, activePeriodId: p.id, periods: [p] };
}

export function defaultLabel(d = new Date()): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed?.periods?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode — the app still works, it just won't remember */
  }
}
