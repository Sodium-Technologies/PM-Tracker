// Billing-cycle date arithmetic. Run: npx tsx scripts/cycle-checks.mts
import { cycleDays, fmtCycle, monthCycle, nextCycle, parseWeekRange, widen } from '../src/lib/cycle';
import { rollForward, newPeriod, newAccount } from '../src/lib/state';
import { parseUpworkCsv, totalsByClient } from '../src/lib/week';
import { readFileSync } from 'node:fs';

let fails = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

eq('a month label is the whole month', monthCycle('September 2026'), { start: '2026-09-01', end: '2026-09-30' });
eq('February in a leap year', monthCycle('February 2028'), { start: '2028-02-01', end: '2028-02-29' });
eq('a label with no month has no cycle', monthCycle('ABC'), null);
eq('a label with a prefix still reads', monthCycle('PM - October 2026'), { start: '2026-10-01', end: '2026-10-31' });

eq('a calendar month moves to the next whole month', nextCycle('2026-09-01', '2026-09-30'), { start: '2026-10-01', end: '2026-10-31' });
eq('a mid-month cycle keeps its days', nextCycle('2026-09-15', '2026-10-14'), { start: '2026-10-15', end: '2026-11-14' });
eq('a day the next month lacks lands on its last day', nextCycle('2026-01-31', '2026-02-27'), { start: '2026-02-28', end: '2026-03-27' });
eq('the end of February moves to the end of March', nextCycle('2026-02-01', '2026-02-28'), { start: '2026-03-01', end: '2026-03-31' });
eq('December rolls into the new year', nextCycle('2026-12-01', '2026-12-31'), { start: '2027-01-01', end: '2027-01-31' });
eq('an unset cycle stays unset', nextCycle('', ''), { start: '', end: '' });

eq('days count both ends', cycleDays('2026-09-01', '2026-09-30'), 30);
eq('a one-day cycle is one day', cycleDays('2026-09-01', '2026-09-01'), 1);
eq('a backwards cycle is caught', (cycleDays('2026-09-30', '2026-09-01') ?? 1) < 1, true);
eq('half a cycle has no length', cycleDays('2026-09-01', ''), null);

eq('written out', fmtCycle('2026-09-01', '2026-09-30'), 'Sep 1 – Sep 30, 2026');
eq('written out across a year', fmtCycle('2026-12-29', '2027-01-04'), 'Dec 29, 2026 – Jan 4, 2027');

eq('an Upwork week', parseWeekRange('Sep 14-Sep 20, 2026'), { start: '2026-09-14', end: '2026-09-20' });
eq('an Upwork week across New Year, with both years',
  parseWeekRange('Dec 29, 2025-Jan 4, 2026'), { start: '2025-12-29', end: '2026-01-04' });
eq('an Upwork week across New Year, with one year',
  parseWeekRange('Dec 29-Jan 4, 2026'), { start: '2025-12-29', end: '2026-01-04' });
eq('nonsense is not a week', parseWeekRange('Bonus'), null);

eq('adding a week stretches a cycle', widen('2026-09-07', '2026-09-13', { start: '2026-09-14', end: '2026-09-20' }),
  { start: '2026-09-07', end: '2026-09-20' });
eq('a week inside a cycle leaves it alone', widen('2026-09-01', '2026-09-30', { start: '2026-09-14', end: '2026-09-20' }),
  { start: '2026-09-01', end: '2026-09-30' });
eq('a week fills an unset cycle', widen('', '', { start: '2026-09-14', end: '2026-09-20' }),
  { start: '2026-09-14', end: '2026-09-20' });

const sep = newPeriod('September 2026');
sep.accounts.push(newAccount({ name: 'Luxe', cycleStart: '2026-09-01', cycleEnd: '2026-09-30' }));
sep.accounts.push(newAccount({ name: 'Doug', cycleStart: '2026-09-15', cycleEnd: '2026-10-14' }));
sep.accounts.push(newAccount({ name: 'Unset' }));
const oct = rollForward(sep);
eq('a new month moves every cycle on', oct.accounts.map((a) => [a.cycleStart, a.cycleEnd]),
  [['2026-10-01', '2026-10-31'], ['2026-10-15', '2026-11-14'], ['', '']]);

const report = parseUpworkCsv(readFileSync(new URL('./fixtures/upwork-sample.csv', import.meta.url), 'utf8'));
const rows = totalsByClient(report.entries);
eq('every client off the report knows the days it covers', rows.every((r) => !!r.cycle), true);
const prm = rows.find((r) => /Post Road/.test(r.name));
eq('a client with several weeks spans them all', !!prm?.cycle && prm.cycle.start <= prm.cycle.end, true);

console.log(fails ? `\n${fails} check(s) failed` : '\nAll billing-cycle checks passed');
process.exit(fails ? 1 : 0);
