/** Billing cycles: the dates a client's bill for the month runs from and to.
 *
 *  Dates are kept as plain calendar days, `YYYY-MM-DD`, with '' meaning "not
 *  set". They are worked out in UTC throughout: a calendar day has no time zone,
 *  and doing this in local time would move a cycle a day for anyone west of
 *  Greenwich. */

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};
const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

export const isDate = (s: string) => day(s) !== null;

/** "October 2026" → the 1st to the 31st of October. Null for a label that names
 *  no month, such as "ABC". */
export function monthCycle(label: string): { start: string; end: string } | null {
  const m = (label ?? '').match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const i = MONTHS.indexOf(m[1].toLowerCase());
  if (i < 0) return null;
  const y = Number(m[2]);
  return { start: iso(new Date(Date.UTC(y, i, 1))), end: iso(new Date(Date.UTC(y, i, lastOfMonth(y, i)))) };
}

/** The same day one month later. A day the next month does not have lands on its
 *  last day, and a cycle that ended on a month's last day ends on the next
 *  month's last day — so 1–30 Sep becomes 1–31 Oct, not 1–30 Oct. */
function plusMonth(s: string): string {
  const d = day(s);
  if (!d) return '';
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate();
  const ny = m === 11 ? y + 1 : y, nm = (m + 1) % 12;
  const endOfMonth = dd === lastOfMonth(y, m);
  return iso(new Date(Date.UTC(ny, nm, endOfMonth ? lastOfMonth(ny, nm) : Math.min(dd, lastOfMonth(ny, nm)))));
}

/** The cycle after this one, for a month started from the last. */
export function nextCycle(start: string, end: string): { start: string; end: string } {
  return { start: plusMonth(start), end: plusMonth(end) };
}

/** Days in a cycle, counting both ends; null unless both ends are set. */
export function cycleDays(start: string, end: string): number | null {
  const a = day(start), b = day(end);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

/** "Sep 1 – Sep 30, 2026", or with both years when the cycle crosses one. */
export function fmtCycle(start: string, end: string): string {
  const a = day(start), b = day(end);
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const y = (d: Date) => d.getUTCFullYear();
  if (a && b) {
    return y(a) === y(b) ? `${md(a)} – ${md(b)}, ${y(b)}` : `${md(a)}, ${y(a)} – ${md(b)}, ${y(b)}`;
  }
  if (a) return `from ${md(a)}, ${y(a)}`;
  if (b) return `until ${md(b)}, ${y(b)}`;
  return '';
}

/** The work week on an Upwork line — "Sep 14-Sep 20, 2026", or
 *  "Dec 29, 2025-Jan 4, 2026" across a new year. Null if it cannot be read. */
export function parseWeekRange(text: string): { start: string; end: string } | null {
  const m = (text ?? '').match(
    /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\s*[-–]\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})/,
  );
  if (!m) return null;
  const sm = SHORT.indexOf(m[1].toLowerCase()), em = SHORT.indexOf(m[4].toLowerCase());
  if (sm < 0 || em < 0) return null;
  const ey = Number(m[6]);
  // A start with no year of its own is in the end's year, unless the week runs
  // over New Year.
  const sy = m[3] ? Number(m[3]) : sm > em ? ey - 1 : ey;
  return {
    start: iso(new Date(Date.UTC(sy, sm, Number(m[2])))),
    end: iso(new Date(Date.UTC(ey, em, Number(m[5])))),
  };
}

/** The smallest cycle covering both: for adding a week to a client. */
export function widen(start: string, end: string, add: { start: string; end: string }) {
  return {
    start: !isDate(start) || add.start < start ? add.start : start,
    end: !isDate(end) || add.end > end ? add.end : end,
  };
}
