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
): { id: string; how: 'exact' | 'close' } | null {
  const want = normalizeName(name);
  if (!want) return null;
  const exact = accounts.find((a) => normalizeName(a.name) === want);
  if (exact) return { id: exact.id, how: 'exact' };
  const close = accounts.filter((a) => {
    const got = normalizeName(a.name);
    return got.length > 2 && want.length > 2 && (got.includes(want) || want.includes(got));
  });
  // Ambiguity is not a match: two candidates means the person has to choose.
  return close.length === 1 ? { id: close[0].id, how: 'close' } : null;
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
