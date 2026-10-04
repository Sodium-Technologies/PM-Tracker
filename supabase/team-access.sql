-- Team members: each one is linked to a person on the payroll and sees only
-- that person's own pay, in the months shared with the team.
--
-- Run once in Supabase → SQL Editor. Safe to run more than once. Also part of
-- schema.sql.
--
-- A team member never receives a month. A month holds every client's rate and
-- everybody's pay, and row-level security can only hand over a whole row or
-- nothing. So the people who keep the books publish one small summary per
-- person per month into team_pay, and a team member may read only the rows
-- with their own name, in months set to "Team".

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

-- Months are no longer readable by a team member, so these redo the check that
-- a team member is allowed to see a month (it lives in can_see_period).
drop policy if exists periods_select on public.periods;
create or replace function public.can_see_period(visibility text, owner_email text, data jsonb)
returns boolean
language sql
stable
as $fn_see$
  select case public.effective_visibility(visibility, data)
    when 'public'  then public.member_role() in ('super_admin', 'editor')
    when 'core'    then public.member_role() in ('super_admin', 'editor')
    when 'private' then lower(coalesce(owner_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    else false
  end
$fn_see$;
create policy periods_select on public.periods
  for select to authenticated
  using (public.can_see_period(visibility, owner_email, data));

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

-- Should say: 1 | 1 | 2
select
  (select count(*) from information_schema.columns
    where table_name = 'app_users' and column_name = 'staff_name') as staff_name_column,
  (select count(*) from information_schema.tables where table_name = 'team_pay') as team_pay_table,
  (select count(*) from pg_policies where tablename = 'team_pay') as team_pay_policies;
