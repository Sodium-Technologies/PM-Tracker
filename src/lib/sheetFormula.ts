import * as XLSX from 'xlsx';

/** Minimal evaluator for the arithmetic formulas these payroll sheets use
 *  (`=B2*C2*85%`, `=((B2*C2)+200)*99%`, `=40+40+22.1`, `=D5/B5`).
 *  Cell references are resolved recursively; anything it cannot reduce to plain
 *  arithmetic returns null and the caller falls back to the cached value. */
const SAFE = /^[0-9+\-*/(). ]+$/;
const REF = /\$?([A-Z]{1,3})\$?([0-9]{1,7})/g;

export const addr = (col: number, row: number) => XLSX.utils.encode_cell({ c: col, r: row });

export function rawValue(ws: XLSX.WorkSheet, a: string): number {
  const v = ws[a]?.v;
  return typeof v === 'number' ? v : 0;
}

export function formulaOf(ws: XLSX.WorkSheet, a: string): string | null {
  const f = ws[a]?.f;
  return typeof f === 'string' && f.length ? f : null;
}

/** Evaluate the formula in `cell`, with `overrides` substituted for the given
 *  cell addresses. Returns null when the formula is not plain arithmetic. */
export function evalCell(
  ws: XLSX.WorkSheet,
  cell: string,
  overrides: Record<string, number> = {},
  depth = 0,
): number | null {
  if (cell in overrides) return overrides[cell];
  if (depth > 8) return null;
  const f = formulaOf(ws, cell);
  if (!f) {
    const v = ws[cell]?.v;
    return typeof v === 'number' ? v : v == null ? 0 : null;
  }
  return evalExpr(ws, f, overrides, depth);
}

export function evalExpr(
  ws: XLSX.WorkSheet,
  expr: string,
  overrides: Record<string, number> = {},
  depth = 0,
): number | null {
  let out = expr.replace(/^=/, '');
  if (/[A-Z]+\s*\(/i.test(out.replace(REF, ''))) return null; // a function call — out of scope
  let failed = false;
  out = out.replace(REF, (m) => {
    const ref = m.replace(/\$/g, '');
    const v = evalCell(ws, ref, overrides, depth + 1);
    if (v == null) { failed = true; return '0'; }
    return `(${v})`;
  });
  if (failed) return null;
  out = out.replace(/([0-9.]+)\s*%/g, (_m, n) => `(${Number(n) / 100})`);
  if (!SAFE.test(out)) return null;
  try {
    // eslint-disable-next-line no-new-func -- input is restricted to arithmetic by SAFE
    const val = Function(`"use strict";return (${out});`)() as unknown;
    return typeof val === 'number' && Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

/** Split a summed hours cell into its individual time entries, keeping each
 *  term intact: `=32+(10/60)+40` is three entries, not three numbers. */
export function splitEntries(ws: XLSX.WorkSheet, cell: string): number[] | null {
  const f = formulaOf(ws, cell);
  if (!f) return null;
  const body = f.replace(/^=/, '').trim();
  const terms: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === '+' && depth === 0) { terms.push(current); current = ''; continue; }
    if (ch === '-' && depth === 0 && current.trim()) { terms.push(current); current = '-'; continue; }
    current += ch;
  }
  terms.push(current);
  if (terms.length < 2) return null;
  const values = terms.map((t) => evalExpr(ws, t));
  if (values.some((v) => v == null)) return null;
  return values as number[];
}

/** Does this formula reference the given cell? */
export function referencesCell(formula: string, cell: string): boolean {
  return new RegExp(`\\$?${cell.replace(/([A-Z]+)(\\d+)/, '$1\\$?$2')}(?![0-9])`).test(formula);
}
