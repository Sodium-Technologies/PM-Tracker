import type { AppState, Period } from './types';
import { normalize } from './state';
import { supabase } from './supabase';

/** One row per period: writes stay small, and two editors working on different
 *  months never overwrite one another. */
interface PeriodRow {
  id: string;
  label: string;
  data: Period;
  /** A real column, not a field inside `data`: row-level security has to read it
   *  to decide whether the row may be returned at all. */
  visibility?: Period['visibility'];
  owner_email?: string | null;
  updated_at?: string;
  updated_by?: string;
}

/** The row as it is written. `visibility` is mirrored out of the period so the
 *  database can police it; `owner_email` is never sent — the trigger stamps it
 *  from the signed-in address, so nobody can claim someone else's month. */
const rowFor = (p: Period) => ({
  id: p.id,
  label: p.label,
  data: p,
  visibility: p.visibility ?? 'core',
});

/** True when the project has not been given the visibility column, or its API
 *  layer has not noticed it yet. Never a reason to lose somebody's work: the
 *  books matter more than the setting, so the write is repeated without it. */
const missingVisibility = (message?: string) =>
  !!message && /visibility/i.test(message) && /column|schema cache/i.test(message);

async function upsertRows(rows: ReturnType<typeof rowFor>[]): Promise<{ error?: string }> {
  if (!supabase) return {};
  const { error } = await supabase.from('periods').upsert(rows, { onConflict: 'id' });
  if (!error) return {};
  if (!missingVisibility(error.message)) return { error: error.message };
  const retry = await supabase
    .from('periods')
    .upsert(rows.map(({ visibility: _drop, ...rest }) => rest), { onConflict: 'id' });
  return retry.error
    ? { error: retry.error.message }
    : { error: undefined };
}

const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];

/** Chronological where the label names a month, stable otherwise. */
export function sortPeriods(periods: Period[]): Period[] {
  const key = (label: string) => {
    const m = label.match(/([A-Za-z]+)\s+(\d{4})/);
    if (!m) return Number.NEGATIVE_INFINITY;
    const i = months.indexOf(m[1].toLowerCase());
    return i < 0 ? Number.NEGATIVE_INFINITY : Number(m[2]) * 12 + i;
  };
  return [...periods].sort((a, b) => key(a.label) - key(b.label));
}

export function stateFrom(periods: Period[], activeId?: string): AppState {
  const ordered = sortPeriods(periods);
  return normalize({
    version: 1,
    periods: ordered,
    activePeriodId: ordered.some((p) => p.id === activeId)
      ? (activeId as string)
      : ordered[ordered.length - 1]?.id ?? '',
  });
}

export async function fetchPeriods(): Promise<{ periods: Period[]; error?: string }> {
  if (!supabase) return { periods: [] };
  let { data, error } = await supabase.from('periods').select('id,label,data,visibility,owner_email');
  // A project that has not run the latest schema has no such columns to select.
  if (error && missingVisibility(error.message)) {
    ({ data, error } = await supabase.from('periods').select('id,label,data'));
  }
  if (error) return { periods: [], error: error.message };
  // The row's own column is the truth about visibility — the copy inside `data`
  // is only what the page last wrote, and the database is what enforces it.
  const periods = ((data as PeriodRow[]) ?? [])
    .map((r) => (r.data ? { ...r.data, visibility: r.visibility ?? r.data.visibility ?? 'core' } : r.data))
    .filter((p): p is Period => !!p && Array.isArray(p.accounts));
  return { periods: sortPeriods(periods) };
}

export async function savePeriod(period: Period): Promise<{ error?: string }> {
  return upsertRows([rowFor(period)]);
}

export async function deletePeriod(id: string): Promise<{ error?: string }> {
  if (!supabase) return {};
  const { error } = await supabase.from('periods').delete().eq('id', id);
  return { error: error?.message };
}

/** Push a whole set of periods — used once, to move existing books up. */
export async function uploadPeriods(periods: Period[]): Promise<{ error?: string }> {
  return upsertRows(periods.map(rowFor));
}

/** Live updates from anyone else editing. Returns an unsubscribe function. */
export function watchPeriods(onChange: () => void): () => void {
  const client = supabase;
  if (!client) return () => {};
  const channel = client
    .channel('periods-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'periods' }, onChange)
    .subscribe();
  return () => { void client.removeChannel(channel); };
}
