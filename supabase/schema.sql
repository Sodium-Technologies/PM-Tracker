-- PM Payroll — access control and shared data.
--
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again; every statement is idempotent.
--
-- THE ONLY LINE YOU MAY NEED TO CHANGE is the admin_email on line 30.
--
-- Three roles (the page calls them Super admin, Admin and Team):
--   super_admin  edits the books and decides who has access
--   editor       edits the books
--   viewer       a team member: linked to one person on the payroll, and sees
--                only that person's own pay — never the books themselves
--
-- And three levels of visibility, per month:
--   private   only the person who created it, whoever else is an administrator
--   core      super_admin and editor
--   public    super_admin and editor, plus each team member's own pay
--
-- Only a super_admin may set a month to private. An editor keeps the books; an
-- editor does not get to put a month out of the administrator's sight.
--
-- Both are enforced by row-level security in the database, not by the page: a
-- viewer calling the API directly still cannot write, an address that is not
-- listed here reads nothing at all, and a private month is not returned to
-- anyone but its owner — the page never has to be trusted to hide it.

-- ---------------------------------------------------------------- 1. who has access

create table if not exists public.app_users (
  email      text primary key,
  role       text not null check (role in ('super_admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  created_by text
);

-- The first administrator. Without this row nobody can administer anything,
-- including you — so set it to the address you will sign in with.
do $$
declare
  admin_email text := 'nav8khan@gmail.com';   -- <<< CHANGE THIS
begin
  insert into public.app_users (email, role)
  values (lower(trim(admin_email)), 'super_admin')
  on conflict (email) do update set role = 'super_admin';
end
$$;

alter table public.app_users enable row level security;

-- The caller's role, read without RLS so the policies below can use it without
-- recursing into the table they protect.
create or replace function public.member_role()
returns text
language sql
stable
security definer
set search_path = public
as $fn_role$
  select u.role
  from public.app_users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$fn_role$;

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

-- An administrator may remove anyone but themselves: deleting your own row
-- would lock the last administrator out of the account.
drop policy if exists app_users_delete on public.app_users;
create policy app_users_delete on public.app_users
  for delete to authenticated
  using (
    public.member_role() = 'super_admin'
    and lower(email) <> lower(auth.jwt() ->> 'email')
  );

-- ---------------------------------------------------------------- 2. the books

create table if not exists public.periods (
  id         text primary key,
  label      text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Added after the first release; both are safe to run on a table that has them.
alter table public.periods
  add column if not exists visibility text not null default 'core';
alter table public.periods
  add column if not exists owner_email text;

do $$
begin
  alter table public.periods
    add constraint periods_visibility_check
    check (visibility in ('private', 'core', 'public'));
exception
  when duplicate_object then null;
end
$$;

alter table public.periods enable row level security;

-- The visibility a row is actually governed by.
--
-- It is written in two places: the column, which the policies read, and a copy
-- inside `data`, which is what the page last saved. They should agree, and when
-- they do not this takes the narrower of the two. A write that reaches one and
-- not the other must never be the one that opens a month up — a setting that
-- fails has to fail closed, or "only me" quietly means "everybody".
create or replace function public.effective_visibility(visibility text, data jsonb)
returns text
language sql
immutable
as $fn_vis$
  select case
    when coalesce(visibility, 'core') = 'private'
      or coalesce(data ->> 'visibility', 'core') = 'private' then 'private'
    when coalesce(visibility, 'core') = 'core'
      or coalesce(data ->> 'visibility', 'core') = 'core' then 'core'
    else 'public'
  end
$fn_vis$;

-- Who may see a month at all. A private month belongs to the address that
-- created it and to nobody else — not even another administrator, because
-- "hidden" that an administrator can undo is not hidden.
--
-- An earlier version of this took two arguments and could not see the copy of
-- the visibility kept inside the month. `create or replace` leaves that one
-- alongside this one rather than replacing it, so it is dropped by name — a
-- superseded function that still decides who sees what is worth being rid of.
-- The policies have to let go of it first, which is why they are dropped here
-- rather than beside the ones that replace them further down.
drop policy if exists periods_select on public.periods;
drop policy if exists periods_insert on public.periods;
drop policy if exists periods_update on public.periods;
drop policy if exists periods_delete on public.periods;
drop function if exists public.can_see_period(text, text);

create or replace function public.can_see_period(visibility text, owner_email text, data jsonb)
returns boolean
language sql
stable
as $fn_see$
  select case public.effective_visibility(visibility, data)
    -- A team member never reads a month itself, public or not: it holds every
    -- client's rate and everybody's pay. What they get is their own summary in
    -- team_pay, below.
    when 'public'  then public.member_role() in ('super_admin', 'editor')
    when 'core'    then public.member_role() in ('super_admin', 'editor')
    when 'private' then lower(coalesce(owner_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    else false
  end
$fn_see$;

drop policy if exists periods_select on public.periods;
create policy periods_select on public.periods
  for select to authenticated
  using (public.can_see_period(visibility, owner_email, data));

-- Hiding a month from everyone else is an administrator's decision. An editor
-- may keep the books; they may not take a month out of the administrator's
-- sight. Checked here rather than in the page, or anyone could do it by calling
-- the API directly.
-- Dropped by name, not replaced: an earlier version gave `data` a default, and
-- `create or replace` will not take a default away. The policies that use it are
-- dropped further up, so this is free to go.
drop function if exists public.may_set_visibility(text, jsonb);
create or replace function public.may_set_visibility(visibility text, data jsonb)
returns boolean
language sql
stable
as $fn_may$
  select public.effective_visibility(visibility, data) <> 'private'
      or public.member_role() = 'super_admin'
$fn_may$;

drop policy if exists periods_insert on public.periods;
create policy periods_insert on public.periods
  for insert to authenticated
  with check (
    public.member_role() in ('super_admin', 'editor')
    and public.may_set_visibility(visibility, data)
  );

-- A month nobody may see is a month nobody may change: without the `using`
-- clause an editor could write over a private month it cannot read.
drop policy if exists periods_update on public.periods;
create policy periods_update on public.periods
  for update to authenticated
  using (
    public.member_role() in ('super_admin', 'editor')
    and public.can_see_period(visibility, owner_email, data)
  )
  with check (
    public.member_role() in ('super_admin', 'editor')
    and public.may_set_visibility(visibility, data)
  );

drop policy if exists periods_delete on public.periods;
create policy periods_delete on public.periods
  for delete to authenticated
  using (
    public.member_role() in ('super_admin', 'editor')
    and public.can_see_period(visibility, owner_email, data)
  );

-- Stamp who last touched a period, and when.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $fn_touch$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.jwt() ->> 'email', new.updated_by);
  -- The owner is stamped from the signed-in address, never taken from the
  -- request, so nobody can claim a private month by writing someone else's
  -- address into it — or their own. An owner that is already set never changes
  -- hands; one that is missing can still be filled, or a month left ownerless by
  -- an older version could never be claimed by anybody and would be lost to
  -- everyone the moment it was marked private.
  if tg_op = 'INSERT' then
    new.owner_email := coalesce(auth.jwt() ->> 'email', new.owner_email);
  elsif public.effective_visibility(new.visibility, new.data) = 'private'
    and public.effective_visibility(old.visibility, old.data) <> 'private'
    and auth.jwt() ->> 'email' is not null then
    -- A month moved into "only me" belongs to whoever moved it there: that is
    -- what "me" means. Only an administrator may make that move — the policy
    -- refuses it from anyone else — and only on a month they can already see,
    -- so it can never take a month away from somebody who had hidden it.
    new.owner_email := auth.jwt() ->> 'email';
  else
    new.owner_email := coalesce(old.owner_email, auth.jwt() ->> 'email', new.owner_email);
  end if;
  return new;
end
$fn_touch$;

drop trigger if exists periods_touch on public.periods;
create trigger periods_touch
  before insert or update on public.periods
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

-- ---------------------------------------------------------------- 2b. the team

-- Each team member is linked to one person on the payroll and sees only that
-- person's own pay, in months shared with the team — never the months.
alter table public.app_users add column if not exists staff_name text;

-- A team member with no person attached would see nothing and not know why.
-- `not valid` leaves any existing row alone; every new or changed one is held
-- to it.
do $fn_chk$
begin
  alter table public.app_users
    add constraint app_users_team_has_person
    check (role <> 'viewer' or nullif(trim(staff_name), '') is not null) not valid;
exception
  when duplicate_object then null;
end
$fn_chk$;

-- The person the caller is linked to, read past RLS like member_role().
create or replace function public.member_staff_name()
returns text
language sql
stable
security definer
set search_path = public
as $fn_staff$
  select lower(trim(u.staff_name))
  from public.app_users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$fn_staff$;
revoke all on function public.member_staff_name() from public;
grant execute on function public.member_staff_name() to authenticated;

create table if not exists public.team_pay (
  period_id  text not null references public.periods(id) on delete cascade,
  member     text not null,           -- the person's name, lowercase and trimmed
  label      text not null,           -- the month, e.g. "September 2026"
  summary    jsonb not null,          -- their pay, and the projects it came from
  updated_at timestamptz not null default now(),
  primary key (period_id, member)
);
alter table public.team_pay enable row level security;

-- Whether the month a summary belongs to may be read by whoever is asking.
-- Security definer, because a team member cannot read the month row itself.
create or replace function public.team_pay_readable(pid text, who text)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn_tp$
  select exists (
    select 1 from public.periods p
    where p.id = pid
      and (
        public.can_see_period(p.visibility, p.owner_email, p.data)
        or (
          public.member_role() = 'viewer'
          and public.effective_visibility(p.visibility, p.data) = 'public'
          and who = public.member_staff_name()
        )
      )
  )
$fn_tp$;
revoke all on function public.team_pay_readable(text, text) from public;
grant execute on function public.team_pay_readable(text, text) to authenticated;

drop policy if exists team_pay_select on public.team_pay;
create policy team_pay_select on public.team_pay
  for select to authenticated
  using (public.team_pay_readable(period_id, member));

drop policy if exists team_pay_write on public.team_pay;
create policy team_pay_write on public.team_pay
  for all to authenticated
  using (
    public.member_role() in ('super_admin', 'editor')
    and public.team_pay_readable(period_id, member)
  )
  with check (
    public.member_role() in ('super_admin', 'editor')
    and public.team_pay_readable(period_id, member)
  );

grant select, insert, update, delete on public.team_pay to authenticated;
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------- 3. check it worked

-- Should return one row: your address, as super_admin.
select email, role, created_at from public.app_users order by created_at;

-- Months that existed before this carry no owner, which would make any of them
-- unreachable the moment it was marked private. This names the first
-- administrator as the owner of every month that has none. It reads the address
-- from the table rather than from auth.jwt(), because the SQL editor runs as the
-- project, not as you, and auth.jwt() is empty there — and the trigger above
-- lets a missing owner be filled, so this statement is not written back out.
update public.periods p
set owner_email = (
  select u.email from public.app_users u
  where u.role = 'super_admin'
  order by u.created_at
  limit 1
)
where p.owner_email is null;
