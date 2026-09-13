import type { AppState, Period } from './types';
import { normalize } from './state';
import { supabase } from './supabase';

/** One row per period: writes stay small, and two editors working on different
 *  months never overwrite one another. */
interface PeriodRow {
  id: string;
  label: string;
  data: Period;
  updated_at?: string;
  updated_by?: string;
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
  const { data, error } = await supabase.from('periods').select('id,label,data');
  if (error) return { periods: [], error: error.message };
  const periods = ((data as PeriodRow[]) ?? [])
    .map((r) => r.data)
    .filter((p): p is Period => !!p && Array.isArray(p.accounts));
  return { periods: sortPeriods(periods) };
}

export async function savePeriod(period: Period): Promise<{ error?: string }> {
  if (!supabase) return {};
  const { error } = await supabase
    .from('periods')
    .upsert({ id: period.id, label: period.label, data: period }, { onConflict: 'id' });
  return { error: error?.message };
}

export async function deletePeriod(id: string): Promise<{ error?: string }> {
  if (!supabase) return {};
  const { error } = await supabase.from('periods').delete().eq('id', id);
  return { error: error?.message };
}

/** Push a whole set of periods — used once, to move existing books up. */
export async function uploadPeriods(periods: Period[]): Promise<{ error?: string }> {
  if (!supabase) return {};
  const rows = periods.map((p) => ({ id: p.id, label: p.label, data: p }));
  const { error } = await supabase.from('periods').upsert(rows, { onConflict: 'id' });
  return { error: error?.message };
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
