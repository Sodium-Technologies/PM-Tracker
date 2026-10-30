/** How the numbers in the time column are meant to be read. */
export type TimeFormat = 'hm' | 'decimal';

export interface ParsedEntry {
  /** the entry in hours, as the money calculation needs it */
  hours: number;
  /** what the reader should see it as */
  text: string;
  /** set when the minutes or seconds are impossible */
  problem?: string;
}

/**
 * `hm` reads a time entry the way a timesheet writes it: the digits after the
 * point are minutes and then seconds, not a fraction of an hour.
 *
 *   12.20    -> 12 h 20 m          (not 12.2 hours)
 *   12.2030  -> 12 h 20 m 30 s
 *   12       -> 12 h
 *
 * `decimal` reads the same number as plain hours, which is what a spreadsheet
 * that multiplies rate by 12.2 has always meant.
 */
export function parseEntry(value: number, format: TimeFormat): ParsedEntry {
  const n = Number(value) || 0;
  if (format === 'decimal') return { hours: n, text: trim(n) };

  const negative = n < 0;
  const abs = Math.abs(n);
  const whole = Math.trunc(abs);
  // Work from the digits as typed: .2 means twenty minutes, not two.
  const decimals = trim(abs).split('.')[1] ?? '';
  const padded = (decimals + '0000').slice(0, 4);
  const minutes = Number(padded.slice(0, 2));
  const seconds = Number(padded.slice(2, 4));

  const hours = (whole + minutes / 60 + seconds / 3600) * (negative ? -1 : 1);
  const text = `${negative ? '−' : ''}${whole}h`
    + (minutes ? ` ${minutes}m` : '')
    + (seconds ? ` ${seconds}s` : '');

  const problem = minutes > 59
    ? `${minutes} minutes — did you mean hours?`
    : seconds > 59
      ? `${seconds} seconds`
      : undefined;

  return { hours, text, problem };
}

export function entriesToHours(entries: number[], format: TimeFormat): number {
  return entries.reduce((total, e) => total + parseEntry(e, format).hours, 0);
}

export function describeEntries(entries: number[], format: TimeFormat): string {
  return entries.map((e) => parseEntry(e, format).text).join(' + ');
}

export function entryProblems(entries: number[], format: TimeFormat): string[] {
  return entries.map((e) => parseEntry(e, format).problem).filter((p): p is string => !!p);
}

/** Hours worked out elsewhere — Upwork's 36.83, which is 36 hours 50 minutes —
 *  written the way this month writes time, so the month reads back exactly the
 *  hours it was given.
 *
 *  In an `hm` month that is hours and minutes: 36.83 becomes 36.50. Writing
 *  36.83 there instead would be read as 36 hours 83 minutes. To the nearest
 *  minute, which is as fine as a timesheet goes. */
export function hoursToEntry(hours: number, format: TimeFormat): number {
  const n = Number(hours) || 0;
  if (format === 'decimal') return Math.round(n * 100) / 100;
  const sign = n < 0 ? -1 : 1;
  const minutes = Math.round(Math.abs(n) * 60);
  return sign * (Math.floor(minutes / 60) + (minutes % 60) / 100);
}

/** An entry as it should be shown in the box. In an `hm` month the minutes are
 *  always two digits — 36.50, not 36.5, which reads as half an hour. */
export function entryAsTyped(value: number, format: TimeFormat): string {
  const text = trim(Number(value) || 0);
  if (format !== 'hm') return text;
  const [whole, decimals] = text.split('.');
  if (!decimals || decimals.length % 2 === 0) return text;
  return `${whole}.${decimals}0`;
}

/** Hours as h/m, for showing a total that came out of the arithmetic. */
export function hoursAsText(hours: number): string {
  const sign = hours < 0 ? '−' : '';
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  if (m === 60) return `${sign}${h + 1}h`;
  return `${sign}${h}h${m ? ` ${m}m` : ''}`;
}

/** A number as typed, without the trailing float noise (0.1+0.2 style). */
export function trim(n: number): string {
  if (!Number.isFinite(n)) return '';
  const cleaned = Math.round(n * 1e9) / 1e9;
  return String(cleaned);
}
