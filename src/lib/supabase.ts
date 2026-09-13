import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Configured through Netlify's environment variables (or a local .env):
 *    VITE_SUPABASE_URL       your project URL
 *    VITE_SUPABASE_ANON_KEY  the anon/publishable key
 *
 *  The anon key is meant to be public — every rule that matters is enforced by
 *  row-level security in the database. With no configuration the app runs
 *  exactly as before, storing everything in this browser.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { persistSession: true } }) : null;

export const cloudEnabled = supabase !== null;
