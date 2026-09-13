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
  const [session, setSession] = React.useState<Session | null>(null);
  const [role, setRole] = React.useState<Role | null>(null);

  const readRole = React.useCallback(async (email: string | undefined) => {
    if (!supabase || !email) { setRole(null); return; }
    // Row-level security limits this to the caller's own row unless they
    // administer the account, so it is safe to ask for it directly.
    const { data } = await supabase
      .from('app_users')
      .select('role')
      .ilike('email', email)
      .maybeSingle();
    setRole((data?.role as Role) ?? null);
  }, []);

  React.useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let live = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!live) return;
      setSession(data.session);
      await readRole(data.session?.user.email);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!live) return;
      setSession(next);
      await readRole(next?.user.email);
      setLoading(false);
    });

    return () => { live = false; sub.subscription.unsubscribe(); };
  }, [readRole]);

  return {
    loading,
    session,
    email: session?.user.email ?? null,
    role,
    canEdit: role === 'super_admin' || role === 'editor',
    isSuperAdmin: role === 'super_admin',
    signOut: async () => { await supabase?.auth.signOut(); },
    refreshRole: async () => { await readRole(session?.user.email); },
  };
}

/** Send a one-time sign-in link. No passwords to set, forget, or leak. */
export async function sendSignInLink(email: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Sign-in is not configured for this deployment.' };
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  return error ? { error: error.message } : {};
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
  const { error } = await supabase.from('app_users').delete().ilike('email', email);
  return { error: error?.message };
}
