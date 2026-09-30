import type { Account } from './types';

/** One line of an Upwork week: what the timesheet says was worked, and what the
 *  transactions say was earned and charged for it. */
export interface WeekRow {
  name: string;
  hours: number;
  earningsUsd: number;
  feeUsd: number;
}

const NUM = /-?[\d,]*\.?\d+/;

/** Read a number out of a cell that may carry a currency symbol, thousands
 *  separators, a trailing "hrs", or parentheses for a negative. */
export function readNumber(cell: string): number | null {
  const text = (cell ?? '').trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || text.trim().startsWith('-');
  const m = text.match(NUM);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

const splitLine = (line: string): string[] =>
  line.includes('\t') ? line.split('\t') : line.split(/\s*,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/);

/** Parse the block pasted into the review screen.
 *
 *  Four fields a line — name, hours, earnings, fee — tab or comma separated. A
 *  header line is skipped, blank lines are ignored, and anything that cannot be
 *  read is reported rather than silently dropped: a week that quietly loses a
 *  client is worse than one that refuses to load. */
export function parseWeek(text: string): { rows: WeekRow[]; problems: string[] } {
  const rows: WeekRow[] = [];
  const problems: string[] = [];
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const [i, line] of lines.entries()) {
    const cells = splitLine(line).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2) { problems.push(`Line ${i + 1}: needs a name and at least the hours.`); continue; }
    const name = cells[0];
    const hours = readNumber(cells[1]);
    // A header line names its columns rather than carrying numbers.
    if (hours === null) {
      if (i === 0 && /hour|time|qty/i.test(cells[1])) continue;
      problems.push(`Line ${i + 1}: could not read hours from "${cells[1]}".`);
      continue;
    }
    rows.push({
      name,
      hours,
      earningsUsd: Math.abs(readNumber(cells[2] ?? '') ?? 0),
      // The fee is a deduction, however it is written down.
      feeUsd: Math.abs(readNumber(cells[3] ?? '') ?? 0),
    });
  }
  return { rows, problems };
}

export const normalizeName = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Find the client this line belongs to. Exact on the normalised name first,
 *  then one containing the other — "Luxe" against "LUXE - Leasing". Never
 *  guesses beyond that: a wrong match puts hours on the wrong client's bill. */
export function findAccount(
  name: string,
  accounts: Account[],
  /** names this account has answered to before, from anywhere in the books:
   *  other-name (lowercased) → the client's own name */
  aliases: Record<string, string> = {},
): { id: string; how: 'exact' | 'close' | 'remembered' } | null {
  const want = normalizeName(name);
  if (!want) return null;

  // A name somebody has already mapped by hand beats any guessing.
  const remembered = aliases[want]
    ?? accounts.find((a) => (a.aliases ?? []).some((x) => normalizeName(x) === want))?.name;
  if (remembered) {
    const hit = accounts.find((a) => normalizeName(a.name) === normalizeName(remembered));
    if (hit) return { id: hit.id, how: 'remembered' };
  }

  const exact = accounts.find((a) => normalizeName(a.name) === want);
  if (exact) return { id: exact.id, how: 'exact' };
  const close = accounts.filter((a) => {
    const got = normalizeName(a.name);
    return got.length > 2 && want.length > 2 && (got.includes(want) || want.includes(got));
  });
  // Ambiguity is not a match: two candidates means the person has to choose.
  return close.length === 1 ? { id: close[0].id, how: 'close' } : null;
}

/** Every project dismissed anywhere in the books, normalised for comparison.
 *  Dismissing one is a standing decision, not a per-month one. */
export function knownIgnored(periods: { ignoredProjects?: string[] }[]): Set<string> {
  const out = new Set<string>();
  for (const p of periods) {
    for (const name of p.ignoredProjects ?? []) {
      const key = normalizeName(name);
      if (key) out.add(key);
    }
  }
  return out;
}

/** Every alias recorded anywhere in the books, so a mapping made in one month is
 *  honoured in all of them. */
export function knownAliases(periods: { accounts: Account[] }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of periods) {
    for (const a of p.accounts) {
      for (const alias of a.aliases ?? []) {
        const key = normalizeName(alias);
        if (key) out[key] = a.name;
      }
    }
  }
  return out;
}

export interface Derived {
  /** earnings ÷ hours */
  rate: number | null;
  /** fee ÷ earnings, as a percentage */
  feePct: number | null;
  /** earnings ÷ the rate already on the client */
  hoursFromMoney: number | null;
  /** the two sources do not agree about how long the week was */
  disagrees: boolean;
}

/** What the transactions imply, and whether they agree with the timesheet.
 *  Half an hour is the tolerance: Upwork rounds, and a rate of $10.004 is the
 *  same rate as $10. */
export function derive(row: WeekRow, existingRate: number): Derived {
  const rate = row.hours > 0 && row.earningsUsd > 0 ? row.earningsUsd / row.hours : null;
  const feePct = row.earningsUsd > 0 ? (row.feeUsd / row.earningsUsd) * 100 : null;
  const hoursFromMoney = existingRate > 0 && row.earningsUsd > 0 ? row.earningsUsd / existingRate : null;
  const disagrees = hoursFromMoney !== null && row.hours > 0
    && Math.abs(hoursFromMoney - row.hours) > 0.5;
  return { rate, feePct, hoursFromMoney, disagrees };
}

/* ---------------------------------------------------------------- Upwork's own report */

/** One paid line off an Upwork transaction report: a week's work on one
 *  contract, with the fee that was charged for it. */
export interface UpworkEntry {
  /** the transaction id that ties the earning to its fee */
  id: string;
  /** when it was paid */
  paid: string;
  paidOn: number;
  /** the work period, e.g. "Aug 31-Sep 6, 2026" */
  week: string;
  /** Upwork's client team — what has to be matched to a client here */
  client: string;
  /** the contract title */
  role: string;
  hours: number;
  earningsUsd: number;
  feeUsd: number;
  rate: number;
  feePct: number;
}

export interface UpworkReport {
  entries: UpworkEntry[];
  /** lines that are money moving, not money earned — withdrawals and their fees */
  otherUsd: number;
  otherCount: number;
  problems: string[];
}

/** Split a CSV line, honouring quoted fields — client names carry commas. */
export function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Sep 25, 2026" as a sortable number. Unparseable dates sort last rather than
 *  throwing: a report is worth reading even if one date is odd. */
export function dateKey(text: string): number {
  const m = (text ?? '').match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s*(\d{4})/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return Number.MAX_SAFE_INTEGER;
  return Number(m[3]) * 10000 + (month + 1) * 100 + Number(m[2]);
}

/** Read an Upwork transaction report.
 *
 *  Each week of work arrives as two lines sharing a transaction id: the Hourly
 *  line carries "40.00 hours x $6.00 = $240.00", the Service Fee line carries
 *  "$240.00 x 10.0% = $24.00". They are paired here, so hours, rate and fee all
 *  come from what Upwork actually charged rather than from anybody's arithmetic.
 *
 *  Withdrawals and withdrawal fees are money leaving the account, not money
 *  earned. They are counted and reported, never folded into hours. */
export function parseUpworkCsv(text: string): UpworkReport {
  const problems: string[] = [];
  const lines = (text ?? '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { entries: [], otherUsd: 0, otherCount: 0, problems: ['That file is empty.'] };

  const head = csvCells(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => head.indexOf(name.toLowerCase());
  const cType = col('Transaction type');
  const cId = col('Transaction ID');
  if (cType < 0 || cId < 0) {
    return {
      entries: [], otherUsd: 0, otherCount: 0,
      problems: ['That does not look like an Upwork transaction report — no "Transaction type" column.'],
    };
  }
  const cDate = col('Date');
  const cWeek = col('Transaction summary details');
  const cRole = col('Transaction summary');
  const cClient = col('Client team');
  const cAmount = col('Amount $');
  const cDesc = col('Description 2');

  const byId = new Map<string, UpworkEntry>();
  let otherUsd = 0;
  let otherCount = 0;

  for (const [i, line] of lines.slice(1).entries()) {
    const c = csvCells(line);
    const type = c[cType] ?? '';
    const amount = Number(c[cAmount] ?? '');
    const desc = c[cDesc] ?? '';

    if (type !== 'Hourly' && type !== 'Service Fee') {
      if (Number.isFinite(amount) && amount !== 0) { otherUsd += amount; otherCount++; }
      continue;
    }

    const id = c[cId] ?? '';
    const at = byId.get(id) ?? {
      id,
      paid: c[cDate] ?? '',
      paidOn: dateKey(c[cDate] ?? ''),
      week: (c[cWeek] ?? '').replace(/^Earnings for\s*/i, ''),
      client: c[cClient] ?? '',
      role: c[cRole] ?? '',
      hours: 0, earningsUsd: 0, feeUsd: 0, rate: 0, feePct: 0,
    };

    if (type === 'Hourly') {
      const m = desc.match(/([\d,.]+)\s*hours?\s*x\s*\$?([\d,.]+)/i);
      if (!m) problems.push(`Line ${i + 2}: could not read hours from "${desc}".`);
      at.hours = m ? Number(m[1].replace(/,/g, '')) : 0;
      at.rate = m ? Number(m[2].replace(/,/g, '')) : 0;
      at.earningsUsd = Number.isFinite(amount) ? Math.abs(amount) : 0;
    } else {
      const m = desc.match(/x\s*([\d.]+)\s*%/);
      at.feePct = m ? Number(m[1]) : 0;
      at.feeUsd = Number.isFinite(amount) ? Math.abs(amount) : 0;
    }
    byId.set(id, at);
  }

  const entries = [...byId.values()]
    .filter((e) => e.client && e.hours > 0)
    .sort((a, b) => a.paidOn - b.paidOn || a.client.localeCompare(b.client));
  return { entries, otherUsd, otherCount, problems };
}

/** Roll the chosen weeks up into one line per client. */
export function totalsByClient(entries: UpworkEntry[]): WeekRow[] {
  const by = new Map<string, WeekRow>();
  for (const e of entries) {
    const at = by.get(e.client) ?? { name: e.client, hours: 0, earningsUsd: 0, feeUsd: 0 };
    at.hours += e.hours;
    at.earningsUsd += e.earningsUsd;
    at.feeUsd += e.feeUsd;
    by.set(e.client, at);
  }
  // Rounded once, at the end: a week of 30.67 hours is Upwork's own rounding,
  // and three of them should not drift.
  return [...by.values()].map((r) => ({
    ...r,
    hours: Math.round(r.hours * 100) / 100,
    earningsUsd: Math.round(r.earningsUsd * 100) / 100,
    feeUsd: Math.round(r.feeUsd * 100) / 100,
  }));
}
