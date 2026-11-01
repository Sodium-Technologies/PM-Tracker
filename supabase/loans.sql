-- Loans and repayments: one private ledger, outside the months.
--
-- Run once in Supabase → SQL Editor. Safe to run more than once.
--
-- This only ADDS things, all named pm_loans…: one table, one trigger function,
-- one trigger and four policies on that table. It changes no existing table,
-- function or policy — the months, the team's pay, the access list, and
-- anything else living in this project (the cko_* tables) are left exactly as
-- they are. It reads member_role(), which already exists; it does not
-- redefine it.
--
-- Who can see a loan: only the address that recorded it, and only while that
-- address is a super admin. Not another super admin, not an admin, not the
-- team — the database refuses them, whatever the page does.

create table if not exists public.pm_loans (
  id          text primary key,
  data        jsonb not null,          -- the loan and its repayments
  owner_email text,                    -- stamped by the trigger, never sent
  updated_at  timestamptz not null default now()
);
alter table public.pm_loans enable row level security;

-- The owner is the signed-in address that recorded the loan — taken from the
-- sign-in, never from the request, so nobody can file a loan under someone
-- else's name or move one to themselves. It never changes afterwards.
create or replace function public.pm_loans_stamp()
returns trigger
language plpgsql
as $fn_pm_loans$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.owner_email := lower(auth.jwt() ->> 'email');
  else
    new.owner_email := old.owner_email;
  end if;
  return new;
end
$fn_pm_loans$;

drop trigger if exists pm_loans_stamp on public.pm_loans;
create trigger pm_loans_stamp
  before insert or update on public.pm_loans
  for each row execute function public.pm_loans_stamp();

drop policy if exists pm_loans_select on public.pm_loans;
create policy pm_loans_select on public.pm_loans
  for select to authenticated
  using (public.member_role() = 'super_admin'
         and lower(owner_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists pm_loans_insert on public.pm_loans;
create policy pm_loans_insert on public.pm_loans
  for insert to authenticated
  with check (public.member_role() = 'super_admin'
              and lower(owner_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists pm_loans_update on public.pm_loans;
create policy pm_loans_update on public.pm_loans
  for update to authenticated
  using (public.member_role() = 'super_admin'
         and lower(owner_email) = lower(auth.jwt() ->> 'email'))
  with check (public.member_role() = 'super_admin'
              and lower(owner_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists pm_loans_delete on public.pm_loans;
create policy pm_loans_delete on public.pm_loans
  for delete to authenticated
  using (public.member_role() = 'super_admin'
         and lower(owner_email) = lower(auth.jwt() ->> 'email'));

revoke all on public.pm_loans from anon;
grant select, insert, update, delete on public.pm_loans to authenticated;
notify pgrst, 'reload schema';

-- Should say: 1 | t | 4 | 1
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'pm_loans')            as loans_table,
  (select relrowsecurity from pg_class where oid = 'public.pm_loans'::regclass) as rls_on,
  (select count(*) from pg_policies where tablename = 'pm_loans')         as loan_policies,
  (select count(*) from pg_trigger where tgname = 'pm_loans_stamp')       as stamp_trigger;
