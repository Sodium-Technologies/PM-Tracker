import { parseWeek, findAccount, derive, readNumber } from '/home/user/PM-Tracker/src/lib/week';
import type { Account } from '/home/user/PM-Tracker/src/lib/types';

let bad = 0;
const is = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
};

is('a dollar amount', readNumber('$1,231.20'), 1231.20);
is('hours with a unit', readNumber('12.20 hrs'), 12.2);
is('a fee in parentheses', readNumber('($123.12)'), -123.12);
is('a bare minus', readNumber('-45.00'), -45);
is('an empty cell', readNumber('  '), null);

const tabbed = `Project\tHours\tEarnings\tFee
Luxe\t20.5\t$205.00\t$20.50
Three Bulls PM\t12\t$120.00\t($12.00)
DET Homes\t8.25\t82.50\t8.25`;
const t = parseWeek(tabbed);
is('a tabbed week reads three rows', t.rows.length, 3);
is('and no problems', t.problems, []);
is('the header is skipped', t.rows[0].name, 'Luxe');
is('a fee in parentheses is still a deduction', t.rows[1].feeUsd, 12);

const comma = `Luxe, 20.5, $205.00, $20.50
"Lakeshore Capital Group, LLC", 4, 40.00, 4.00`;
const c = parseWeek(comma);
is('a quoted name keeps its comma', c.rows[1].name, 'Lakeshore Capital Group, LLC');
is('and its hours', c.rows[1].hours, 4);

const broken = parseWeek('Luxe\nSomething\tnonsense');
is('a line with no hours is reported', broken.problems.length, 2);
is('rather than dropped in silence', broken.rows.length, 0);

const accounts = [
  { id: 'a', name: 'Luxe' }, { id: 'b', name: 'LUXE - Leasing' },
  { id: 'c', name: 'Three Bulls PM' }, { id: 'd', name: 'DET Homes' },
] as Account[];
is('an exact name matches', findAccount('three bulls pm', accounts)?.id, 'c');
is('and says how', findAccount('DET  Homes', accounts)?.how, 'exact');
const twoLuxes = [{ id: 'b', name: 'LUXE - Leasing' }, { id: 'e', name: 'LUXE - Rehan' }] as Account[];
is('two candidates is not a match', findAccount('Luxe', twoLuxes), null);
is('but an exact name still wins over them',
   findAccount('Luxe', [...twoLuxes, { id: 'a', name: 'Luxe' }] as Account[])?.id, 'a');
is('a single near name matches', findAccount('DET', accounts)?.how, 'close');
is('an unknown name matches nothing', findAccount('Carla Elfield', accounts), null);

const d = derive({ name: 'Luxe', hours: 20, earningsUsd: 200, feeUsd: 20 }, 10);
is('the rate comes out of the money', d.rate, 10);
is('so does the fee', d.feePct, 10);
is('the two sources agree', d.disagrees, false);
const off = derive({ name: 'Luxe', hours: 20, earningsUsd: 250, feeUsd: 25 }, 10);
is('and a disagreement is caught', off.disagrees, true);

console.log(bad ? `\n${bad} failed` : '\nAll week-reading checks passed');
process.exit(bad ? 1 : 0);
