/**
 * Build a seed file the app loads on a fresh browser.
 *
 *   npm run seed -- <out.json> <mastersheet.xlsx> [more.xlsx ...]
 *
 * Every payroll tab in every workbook is parsed with the app's own importer.
 * When two workbooks carry the same month, the one named later on the command
 * line wins — so put the corrected file last.
 */
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { parseSheet } from '../src/lib/xlsx';
import { computePeriod } from '../src/lib/calc';
import type { AppState, Period } from '../src/lib/types';

const [out, ...files] = process.argv.slice(2);
if (!out || !files.length) {
  console.error('usage: npm run seed -- <out.json> <mastersheet.xlsx> [more.xlsx ...]');
  process.exit(2);
}

const byLabel = new Map<string, Period>();
for (const file of files) {
  const wb = XLSX.read(fs.readFileSync(file), { cellFormula: true });
  for (const name of wb.SheetNames) {
    const period = parseSheet(name.trim(), wb.Sheets[name]);
    if (!period || !period.accounts.length) continue;
    byLabel.set(period.label, period);
  }
}

/** Chronological where the label parses as a month, and stable otherwise. */
const monthIndex = (label: string) => {
  const m = label.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return Number.NEGATIVE_INFINITY;
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const i = months.indexOf(m[1].toLowerCase());
  return i < 0 ? Number.NEGATIVE_INFINITY : Number(m[2]) * 12 + i;
};

const periods = [...byLabel.values()].sort((a, b) => monthIndex(a.label) - monthIndex(b.label));
const state: AppState = {
  version: 1,
  activePeriodId: periods[periods.length - 1].id,
  periods,
};

fs.writeFileSync(out, JSON.stringify(state, null, 2));

console.log(`wrote ${out} — ${periods.length} periods`);
for (const p of periods) {
  const r = computePeriod(p);
  console.log(
    `  ${p.label.padEnd(32)} $${r.totals.earnedUsd.toFixed(2).padStart(9)}` +
    `  team PKR ${Math.round(r.totals.freelancerPkr).toLocaleString().padStart(11)}` +
    `  ${p.accounts.length} accounts, ${p.staff.length} people`,
  );
}
