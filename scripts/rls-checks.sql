-- Does a private month really stay private?
--
-- Run against a throwaway Postgres, standing in for Supabase:
--   scripts/rls-checks.sh
--
-- Supabase gives every request an `auth.jwt()`; here that is faked from a
-- setting, exactly as Supabase builds it, so supabase/schema.sql runs unchanged.

create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
grant usage on schema public, auth to authenticated, anon;
