-- PM Payroll — access control and shared data.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is safe to run again: every statement is idempotent.
--
-- Three roles:
--   super_admin  manages who has access, and edits the books
--   editor       edits the books
--   viewer       reads the books, changes nothing
--
-- Access is enforced by row-level security in the database, not by the page.
-- A viewer who opens dev tools and calls the API directly still cannot write,
-- and someone with no row in app_users sees nothing at all.

-- ---------------------------------------------------------------- who has access

create table if not exists public.app_users (
  email      text primary key,
  role       text not null check (role in ('super_admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  created_by text
);

alter table public.app_users enable row level security;

-- The caller's role, read without RLS so policies can use it without recursing
-- into the same table they protect.
create or replace function public.member_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.app_users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

revoke all on function public.member_role() from public;
grant execute on function public.member_role() to authenticated;

drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated
  using (
    lower(email) = lower(auth.jwt() ->> 'email')
    or public.member_role() = 'super_admin'
  );

drop policy if exists app_users_insert on public.app_users;
create policy app_users_insert on public.app_users
  for insert to authenticated
  with check (public.member_role() = 'super_admin');

drop policy if exists app_users_update on public.app_users;
create policy app_users_update on public.app_users
  for update to authenticated
  using (public.member_role() = 'super_admin')
  with check (public.member_role() = 'super_admin');

-- A super admin may remove anyone but themselves: deleting your own row would
-- lock the last administrator out of the account.
drop policy if exists app_users_delete on public.app_users;
create policy app_users_delete on public.app_users
  for delete to authenticated
  using (
    public.member_role() = 'super_admin'
    and lower(email) <> lower(auth.jwt() ->> 'email')
  );

-- ---------------------------------------------------------------- the books

create table if not exists public.periods (
  id         text primary key,
  label      text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.periods enable row level security;

drop policy if exists periods_select on public.periods;
create policy periods_select on public.periods
  for select to authenticated
  using (public.member_role() is not null);

drop policy if exists periods_insert on public.periods;
create policy periods_insert on public.periods
  for insert to authenticated
  with check (public.member_role() in ('super_admin', 'editor'));

drop policy if exists periods_update on public.periods;
create policy periods_update on public.periods
  for update to authenticated
  using (public.member_role() in ('super_admin', 'editor'))
  with check (public.member_role() in ('super_admin', 'editor'));

drop policy if exists periods_delete on public.periods;
create policy periods_delete on public.periods
  for delete to authenticated
  using (public.member_role() in ('super_admin', 'editor'));

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.jwt() ->> 'email', new.updated_by);
  return new;
end
$$;

drop trigger if exists periods_touch on public.periods;
create trigger periods_touch before insert or update on public.periods
  for each row execute function public.touch_updated_at();

-- Live updates between people working at the same time. Harmless if the
-- publication already carries the table.
do $$
begin
  alter publication supabase_realtime add table public.periods;
exception
  when duplicate_object then null;
  when undefined_object then null;
end
$$;

-- ---------------------------------------------------------------- first administrator
--
-- CHANGE THIS EMAIL to the address you sign in with, then run the file.
-- Without this row nobody can administer anything, including you.

insert into public.app_users (email, role)
values ('nav8khan@gmail.com', 'super_admin')
on conflict (email) do update set role = 'super_admin';
