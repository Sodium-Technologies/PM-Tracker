import React from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Role = 'super_admin' | 'editor' | 'viewer';

export interface Account {
  email: string;
  role: Role;
  created_at?: string;
  created_by?: string;
}

export interface Auth {
  /** null while the session is still being restored */
  loading: boolean;
  /** set when the sign-in service cannot be reached or answers with an error */
  error: string | null;
  session: Session | null;
  email: string | null;
  /** null when signed in but not on the access list */
  role: Role | null;
  canEdit: boolean;
  isSuperAdmin: boolean;
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
}

export function useAuth(): Auth {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [session, setSession] = React.useState<Session | null>(null);
  const [role, setRole] = React.useState<Role | null>(null);

  const readRole = React.useCallback(async (email: string | undefined) => {
    if (!supabase || !email) { setRole(null); return; }
    // Row-level security limits this to the caller's own row unless they
    // administer the account, so it is safe to ask for it directly.
    //
    // An empty result and a failed request mean completely different things:
    // the first is "not on the access list", the second is "the database did
    // not answer". Telling an administrator the first when it is the second
    // sends them looking for the wrong problem.
    try {
      // Match exactly. `ilike` would treat `_` and `%` in an address as
      // wildcards, so nav_khan@… could match navXkhan@… — wrong row, wrong
      // role. Addresses are stored lowercase, so compare lowercase.
      const { data, error: err } = await supabase
        .from('app_users')
        .select('role')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();
      if (err) { setError(err.message); return; }
      setError(null);
      setRole((data?.role as Role) ?? null);
    } catch (e) {
      setError((e as Error).message || 'The database did not answer.');
    }
  }, []);

  React.useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let live = true;

    // Never sit on a spinner: if the project cannot be reached, say so.
    const timeout = window.setTimeout(() => {
      if (!live) return;
      setError('The sign-in service did not respond. Check VITE_SUPABASE_URL and that the project is running.');
      setLoading(false);
    }, 12000);

    supabase.auth.getSession()
      .then(async ({ data, error: err }) => {
        if (!live) return;
        if (err) setError(err.message);
        setSession(data.session);
        await readRole(data.session?.user.email);
      })
      .catch((e: Error) => { if (live) setError(e.message); })
      .finally(() => { if (live) { window.clearTimeout(timeout); setLoading(false); } });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!live) return;
      setSession(next);
      await readRole(next?.user.email);
      setLoading(false);
    });

    return () => { live = false; window.clearTimeout(timeout); sub.subscription.unsubscribe(); };
  }, [readRole]);

  return {
    loading,
    error,
    session,
    email: session?.user.email ?? null,
    role,
    canEdit: role === 'super_admin' || role === 'editor',
    isSuperAdmin: role === 'super_admin',
    signOut: async () => { await supabase?.auth.signOut(); },
    refreshRole: async () => { await readRole(session?.user.email); },
  };
}

/** A sign-in link that fails comes back as an error in the URL rather than a
 *  session. Without this the page just shows the sign-in form again, which reads
 *  as "sign-in is broken" instead of "that link expired". */
export function signInErrorFromUrl(): string | null {
  const read = (s: string) => new URLSearchParams(s);
  const query = read(window.location.search);
  const hash = read(window.location.hash.replace(/^#/, ''));
  const code = query.get('error') ?? hash.get('error');
  if (!code) return null;
  const description = (query.get('error_description') ?? hash.get('error_description') ?? '')
    .replace(/\+/g, ' ');
  // Check the specific cause before the generic one: a PKCE failure arrives as
  // `invalid_request`, which would otherwise be read as an expired link.
  if (/flow_state|code verifier|pkce/i.test(code + description))
    return 'That link was opened in a different browser from the one that requested it. '
      + 'Request a new link and open it in this browser.';
  if (/expired|invalid|otp/i.test(code + description))
    return 'That sign-in link has expired or was already used. Request a new one below.';
  return description || `Sign-in failed: ${code}`;
}

/** Clear the error out of the address bar so a reload does not repeat it. */
export function clearUrlError() {
  if (window.location.search || window.location.hash) {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

/** Send the sign-in email. It carries both a link and a six-digit code. */
/** True when the page is running as an installed app rather than a browser tab:
 *  an iOS home-screen app, or an installed PWA elsewhere.
 *
 *  This matters for sign-in. An installed app has its own storage, separate from
 *  the browser's, and it can never be the target of a link opened from Mail — so
 *  a magic link requested here opens in Safari, which holds neither the PKCE
 *  verifier this app wrote nor, afterwards, a session this app can see. The code
 *  is the only method that works, because it never leaves this window. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return iosStandalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true
    || window.matchMedia?.('(display-mode: fullscreen)').matches === true;
}

export async function sendSignInEmail(email: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Sign-in is not configured for this deployment.' };
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    // Where the link lands if they use one. An installed app cannot be a link
    // target, so this only ever matters in a browser tab.
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  return error ? { error: error.message } : {};
}

/** Sign in with the code from the email instead of the link.
 *
 *  The link depends on the project's Site URL and redirect list being right, on
 *  the same browser holding the verifier, and on no mail scanner having opened
 *  it first — each of which silently breaks sign-in for everyone. The code
 *  depends on none of that: it is typed into the page that asked for it. */
export async function signInWithCode(email: string, token: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Sign-in is not configured for this deployment.' };
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  });
  if (!error) return {};
  return {
    error: /expired|invalid/i.test(error.message)
      ? 'That code is wrong or has expired. Request a new one.'
      : error.message,
  };
}

/** The access list. Readable in full only by a super admin. */
export async function listAccounts(): Promise<Account[]> {
  if (!supabase) return [];
  const { data } = await supabase.from('app_users').select('*').order('created_at');
  return (data as Account[]) ?? [];
}

export async function grantAccess(email: string, role: Role, by: string | null) {
  if (!supabase) return { error: 'not configured' };
  const { error } = await supabase
    .from('app_users')
    .upsert({ email: email.trim().toLowerCase(), role, created_by: by }, { onConflict: 'email' });
  return { error: error?.message };
}

export async function revokeAccess(email: string) {
  if (!supabase) return { error: 'not configured' };
  // Exact match, for the same reason as the lookup: a wildcard here would
  // revoke somebody else.
  const { error } = await supabase
    .from('app_users')
    .delete()
    .eq('email', email.trim().toLowerCase());
  return { error: error?.message };
}
