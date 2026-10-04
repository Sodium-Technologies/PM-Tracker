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

/** A write either fails, or succeeds — possibly with something worth saying. */
export interface WriteResult { error?: string; warning?: string }

const refusedByPolicy = (message?: string) => !!message && /row-level security/i.test(message);

/** Who the database will take this request to be — read from the token the
 *  request actually carries, not from what the page remembers about the person.
 *  When the two disagree, the token is the one that counts. */
export async function tokenIdentity(): Promise<{ email: string | null; role: string; expiresInMin: number | null }> {
  if (!supabase) return { email: null, role: 'none', expiresInMin: null };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { email: null, role: 'anon', expiresInMin: null };
  // If the token cannot be read, fall back to the session's own record of who it
  // belongs to — and claim nothing about whether it has expired.
  const fallback = { email: data.session?.user?.email ?? null, role: 'unknown', expiresInMin: null };
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
    return {
      email: claims.email ?? null,
      role: claims.role ?? 'unknown',
      expiresInMin: typeof claims.exp === 'number' ? Math.round((claims.exp * 1000 - Date.now()) / 60000) : null,
    };
  } catch {
    return fallback;
  }
}

/** Turn a refusal into something a person can act on. */
async function explainRefusal(original: string): Promise<string> {
  const who = await tokenIdentity();
  if (!who.email || who.role === 'anon') {
    return 'Your sign-in has run out, so the database did not know who was saving. '
      + 'Sign out and back in — nothing you typed is lost while this page stays open.';
  }
  if (who.expiresInMin !== null && who.expiresInMin < 0) {
    return `Your sign-in as ${who.email} expired ${-who.expiresInMin} min ago. Sign out and back in.`;
  }
  // The sign-in is sound. Whether the refusal is about the person or about the
  // rules depends on what the access list says about this address.
  const { data } = await supabase!.from('app_users').select('role').eq('email', who.email.toLowerCase());
  const listed = (data as { role: string }[] | null)?.[0]?.role;
  if (!listed) {
    return `${who.email} is not on the access list, so the database will not take a save from it. `
      + 'Sign in with the address you were given access on.';
  }
  if (listed === 'viewer') {
    return `${who.email} can look but not change, so the database refused the save.`;
  }
  return `Signed in as ${who.email} (${listed === 'super_admin' ? 'administrator' : 'editor'}), and the `
    + "database's rules still refused it — they are out of step with this app. Run "
    + "supabase/repair-visibility.sql, then notify pgrst, 'reload schema'. (" + original + ')';
}

async function upsertRows(rows: ReturnType<typeof rowFor>[]): Promise<WriteResult> {
  if (!supabase) return {};
  let { error } = await supabase.from('periods').upsert(rows, { onConflict: 'id' });
  if (!error) return {};

  // A refusal from the policies most often means the session behind this tab has
  // lapsed — a phone that slept, a tab left open overnight — while the page still
  // shows everything it loaded. Refresh it once and try again before saying no.
  if (refusedByPolicy(error.message)) {
    await supabase.auth.refreshSession();
    ({ error } = await supabase.from('periods').upsert(rows, { onConflict: 'id' }));
    if (!error) return {};
    if (refusedByPolicy(error.message)) return { error: await explainRefusal(error.message) };
  }
  if (!missingVisibility(error.message)) return { error: error.message };

  const retry = await supabase
    .from('periods')
    .upsert(rows.map(({ visibility: _drop, ...rest }) => rest), { onConflict: 'id' });
  if (retry.error) {
    return { error: refusedByPolicy(retry.error.message) ? await explainRefusal(retry.error.message) : retry.error.message };
  }

  // The books are saved, but the column the database reads to decide who may
  // open them was not. The copy inside `data` still says private and the policy
  // takes the narrower of the two, so nothing is exposed — but a person who
  // just hid a month is owed the truth about where that setting got to.
  if (rows.some((r) => r.visibility === 'private')) {
    return {
      warning: 'Saved — but this project is missing the visibility column, so who '
        + 'can open the month is not being enforced on the database side yet. '
        + 'Run supabase/schema.sql, then reload the schema.',
    };
  }
  return {};
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

export async function savePeriod(period: Period): Promise<WriteResult> {
  return upsertRows([rowFor(period)]);
}

export async function deletePeriod(id: string): Promise<{ error?: string }> {
  if (!supabase) return {};
  const { error } = await supabase.from('periods').delete().eq('id', id);
  return { error: error?.message };
}

/** Push a whole set of periods — used once, to move existing books up. */
export async function uploadPeriods(periods: Period[]): Promise<WriteResult> {
  const all = await upsertRows(periods.map(rowFor));
  if (!all.error) return all;

  // One month the database refuses sinks the whole batch, and the message names
  // the table rather than the month — so the months that can be written are
  // written one at a time, and the ones that cannot are named.
  const refused: string[] = [];
  let warning: string | undefined;
  for (const p of periods) {
    const one = await upsertRows([rowFor(p)]);
    if (one.error) refused.push(p.label);
    if (one.warning) warning = one.warning;
  }
  if (!refused.length) return { warning };
  return {
    error: refused.length === periods.length
      ? all.error
      : `Saved all but ${refused.join(', ')} — the database refused ${refused.length === 1 ? 'that month' : 'those months'}: ${all.error}`,
  };
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
