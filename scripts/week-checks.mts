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


/* ---------------------------------------------------------------- the real report */
import fs from 'fs';
import { parseUpworkCsv, totalsByClient, csvCells, dateKey } from '/home/user/PM-Tracker/src/lib/week';

is('a quoted field keeps its comma', csvCells('a,"b,c",d'), ['a', 'b,c', 'd']);
is('a doubled quote is one quote', csvCells('"say ""hi""",x'), ['say "hi"', 'x']);
is('dates sort chronologically', [dateKey('Sep 4, 2026'), dateKey('Sep 25, 2026')].every((n, i, a) => i === 0 || a[i - 1] < n), true);
is('a nonsense date sorts last', dateKey('whenever'), Number.MAX_SAFE_INTEGER);

const CSV = '/root/.claude/uploads/e4902f66-8527-5b47-9aba-673f2b3181bc/56b63570-2026-09-30_transaction_report.csv';
if (fs.existsSync(CSV)) {
  const rep = parseUpworkCsv(fs.readFileSync(CSV, 'utf8'));
  is('the report reads every paid week', rep.entries.length, 14);
  is('with nothing unreadable', rep.problems, []);
  is('withdrawals are counted, not earned', rep.otherCount, 6);
  is('and they total what left the account', Math.round(rep.otherUsd * 100) / 100, -2295.56);

  const clients = [...new Set(rep.entries.map((e) => e.client))].sort();
  is('four clients', clients, ['BSF', 'Post Road Management LLC', 'Texas Corporate Homes', 'Three Bulls Group']);

  const all = totalsByClient(rep.entries).sort((a, b) => a.name.localeCompare(b.name));
  is('BSF totals', all[0], { name: 'BSF', hours: 40, earningsUsd: 400, feeUsd: 60 });
  is('Post Road totals', all[1], { name: 'Post Road Management LLC', hours: 152, earningsUsd: 1368, feeUsd: 136.8 });
  is('Texas totals', all[2], { name: 'Texas Corporate Homes', hours: 82, earningsUsd: 492, feeUsd: 49.2 });
  is('Three Bulls totals', all[3], { name: 'Three Bulls Group', hours: 83, earningsUsd: 830, feeUsd: 124.5 });

  const weeks = [...new Set(rep.entries.map((e) => e.week))];
  is('four work weeks, oldest first', weeks,
     ['Aug 24-Aug 30, 2026', 'Aug 31-Sep 6, 2026', 'Sep 7-Sep 13, 2026', 'Sep 14-Sep 20, 2026']);

  const dropAug = totalsByClient(rep.entries.filter((e) => e.week !== 'Aug 24-Aug 30, 2026'));
  is('dropping a week drops its hours', dropAug.find((r) => r.name === 'BSF')!.hours, 30);

  const rates = rep.entries.filter((e) => e.client === 'Texas Corporate Homes');
  is('the rate comes off the line itself', rates[0].rate, 6);
  is('and so does the fee percentage', rates[0].feePct, 10);
}

is('a file that is not a report says so',
   parseUpworkCsv('name,amount\nfoo,1').problems.length > 0, true);
is('an empty file says so', parseUpworkCsv('').problems.length, 1);


/* ---------------------------------------------------------------- remembering a mapping */
import { knownAliases } from '/home/user/PM-Tracker/src/lib/week';

const withAlias = [
  { id: 'x', name: 'Doug', aliases: ['BSF'] },
  { id: 'y', name: 'Texas Homes', aliases: ['Texas Corporate Homes'] },
] as Account[];
is('a remembered name matches', findAccount('BSF', withAlias)?.id, 'x');
is('and says it was remembered', findAccount('bsf', withAlias)?.how, 'remembered');
is('a name that matches nothing still matches nothing', findAccount('Nobody', withAlias), null);
is('two names neither of which contains the other',
   findAccount('Texas Corporate Homes', withAlias)?.id, 'y');

const map = knownAliases([{ accounts: withAlias }]);
is('aliases are gathered from every month', map['bsf'], 'Doug');
is('a mapping from another month is honoured here',
   findAccount('BSF', [{ id: 'z', name: 'Doug', aliases: [] }] as Account[], map)?.how, 'remembered');


/* ---------------------------------------------------------------- dismissing a project */
import { knownIgnored } from '/home/user/PM-Tracker/src/lib/week';

is('nothing dismissed to begin with', knownIgnored([{}]).size, 0);
const dismissed = knownIgnored([
  { ignoredProjects: ['Some Other Client'] },
  { ignoredProjects: ['Some Other Client', 'A Personal Thing'] },
]);
is('dismissals gather from every month, without repeating', dismissed.size, 2);
is('and match however the name is written', dismissed.has('some other client'), true);
is('a project nobody dismissed is not dismissed', dismissed.has('post road management llc'), false);

console.log(bad ? `\n${bad} failed overall` : '\nAll week-reading checks passed');
process.exit(bad ? 1 : 0);
