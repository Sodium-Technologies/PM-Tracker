/**
 * Turn a seed file into SQL you can paste into the Supabase SQL editor.
 *
 *   node scripts/seed-sql.mjs <seed.json> [out.sql]
 *
 * Loading the books this way needs no keys and no sign-in: the SQL editor runs
 * with privileges above row-level security, so the rows land whatever the access
 * list currently says. Re-running is safe — each period is upserted by id.
 */
import { readFileSync, writeFileSync } from 'fs';

const [input, output = 'supabase/seed-periods.sql'] = process.argv.slice(2);
if (!input) {
  console.error('usage: node scripts/seed-sql.mjs <seed.json> [out.sql]');
  process.exit(2);
}

const state = JSON.parse(readFileSync(input, 'utf8'));
const periods = state.periods ?? [];
if (!periods.length) { console.error('no periods in that file'); process.exit(2); }

/** Dollar-quote the JSON so nothing inside it has to be escaped. Pick a tag the
 *  content cannot contain. */
function dollarQuote(text) {
  let tag = 'p';
  while (text.includes(`$${tag}$`)) tag += 'p';
  return `$${tag}$${text}$${tag}$`;
}

const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

const lines = [
  '-- CKO PM Payroll — the books, ready to paste into Supabase (SQL Editor → New query).',
  '--',
  `-- ${periods.length} periods: ${periods[0].label} … ${periods[periods.length - 1].label}`,
  '-- Generated from the mastersheet; safe to run more than once.',
  '--',
  '-- Requires the tables from schema.sql. If you would rather not paste SQL, sign',
  '-- in to the app as an administrator and use Import sheet or backup instead —',
  '-- same result.',
  '',
  'begin;',
  '',
];

for (const p of periods) {
  const json = JSON.stringify(p);
  lines.push(
    `-- ${p.label}: ${p.accounts.length} accounts, ${p.staff.length} people`,
    'insert into public.periods (id, label, data) values',
    `  (${sqlString(p.id)}, ${sqlString(p.label)}, ${dollarQuote(json)}::jsonb)`,
    'on conflict (id) do update set label = excluded.label, data = excluded.data;',
    '',
  );
}

lines.push(
  'commit;',
  '',
  '-- What landed:',
  'select label, jsonb_array_length(data->\'accounts\') as accounts,',
  '       jsonb_array_length(data->\'staff\') as people, updated_at',
  'from public.periods order by updated_at;',
  '',
);

writeFileSync(output, lines.join('\n'));
const bytes = Buffer.byteLength(lines.join('\n'));
console.log(`wrote ${output} — ${periods.length} periods, ${(bytes / 1024).toFixed(0)} KB`);
