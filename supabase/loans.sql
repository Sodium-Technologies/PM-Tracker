-- Loans and repayments: one private ledger, outside the months.
--
-- Run once in Supabase → SQL Editor. Safe to run more than once.
--
-- WHAT THIS DOES — AND DOES NOT — DO
--
-- It only ADDS, and only things named pm_loans…: one table, one trigger
-- function, one trigger, four access rules on that table, and that table's
-- grants. It contains no DROP, no DELETE, no UPDATE, no INSERT and no
-- "or replace" of anything real. Anything it adds that already exists is left
-- exactly as it is.
--
-- It also checks itself. Before adding anything it takes a fingerprint of the
-- whole public schema — every table, column, constraint, index, access rule,
-- trigger, function, grant, and every row of data in every table — leaving
-- out only the pm_loans… objects it adds. Afterwards it takes the fingerprint
-- again. If anything outside pm_loans differs, it stops with an error and NONE
-- of it is applied: all of it runs as a single statement, which the database
-- applies whole or not at all. That covers this app's tables and every other
-- table in the project, including the cko_* tables.
--
-- (If someone saves something in either app during the second or two this
-- runs, the data fingerprint will differ and it will stop, changing nothing.
-- Just run it again.)
--
-- Who can see a loan: only the address that recorded it, and only while that
-- address is a super admin. Not another super admin, not an admin, not the
-- team — the database refuses them, whatever the page does.

-- The fingerprint. pg_temp is this session's own scratch space: the function
-- lives only for as long as this connection does, no one else can see it, and
-- nothing in the database proper is created or changed by it.
create or replace function pg_temp.pm_loans_public_state()
returns table(kind text, name text, detail text)
language plpgsql
as $fn_state$
declare
  t record;
  digest text;
begin
  return query
    select 'schema', n.nspname::text, coalesce(n.nspacl::text, '')
    from pg_namespace n where n.nspname = 'public';
  return query
    select 'relation', c.relname::text,
           concat_ws(' ', c.relkind::text, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text,
                     case when c.relkind in ('v', 'm') then md5(pg_get_viewdef(c.oid)) end)
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relname not like 'pm\_loans%';
  return query
    select 'column', c.relname::text || '.' || a.attname::text,
           concat_ws(' ', format_type(a.atttypid, a.atttypmod), a.attnotnull,
                     pg_get_expr(d.adbin, d.adrelid), a.attacl::text)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where c.relnamespace = 'public'::regnamespace and c.relname not like 'pm\_loans%'
      and a.attnum > 0 and not a.attisdropped;
  return query
    select 'constraint', con.conrelid::regclass::text || '.' || con.conname::text, pg_get_constraintdef(con.oid)
    from pg_constraint con
    where con.connamespace = 'public'::regnamespace and con.conname not like 'pm\_loans%';
  return query
    select 'index', i.indexname::text, i.indexdef
    from pg_indexes i
    where i.schemaname = 'public' and i.tablename not like 'pm\_loans%';
  return query
    select 'policy', p.tablename::text || '.' || p.policyname::text,
           concat_ws(' | ', p.permissive, p.roles::text, p.cmd, p.qual, p.with_check)
    from pg_policies p
    where p.schemaname = 'public' and p.tablename not like 'pm\_loans%';
  return query
    select 'trigger', tg.tgrelid::regclass::text || '.' || tg.tgname::text,
           concat_ws(' ', pg_get_triggerdef(tg.oid), tg.tgenabled::text)
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    where not tg.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname not like 'pm\_loans%';
  return query
    select 'function', p.oid::regprocedure::text,
           md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname not like 'pm\_loans%'
      and p.prokind in ('f', 'p');
  -- Every row of every table, as a count and a checksum of the contents.
  for t in
    select c.oid, c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      and c.relname not like 'pm\_loans%'
  loop
    execute format(
      'select count(*)::text || '' '' || coalesce(md5(string_agg(x::text, chr(10) order by x::text)), '''') from %s x',
      t.oid::regclass) into digest;
    return query select 'data', t.relname::text, digest;
  end loop;
end
$fn_state$;

do $loans$
declare
  before text[];
  after  text[];
  diff   text;
begin
  before := array(select concat_ws(' :: ', kind, name, detail) from pg_temp.pm_loans_public_state() order by 1);

  -- 1. The table. One row per loan; its repayments travel inside `data`.
  create table if not exists public.pm_loans (
    id          text primary key,
    data        jsonb not null,          -- the loan and its repayments
    owner_email text,                    -- stamped by the trigger, never sent
    updated_at  timestamptz not null default now()
  );
  alter table public.pm_loans enable row level security;

  -- 2. The owner is the signed-in address that recorded the loan — taken from
  --    the sign-in, never from the request, so nobody can file a loan under
  --    someone else's name or move one to themselves. It never changes.
  if not exists (select 1 from pg_proc
                 where pronamespace = 'public'::regnamespace and proname = 'pm_loans_stamp') then
    create function public.pm_loans_stamp()
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
  end if;

  if not exists (select 1 from pg_trigger
                 where tgrelid = 'public.pm_loans'::regclass and tgname = 'pm_loans_stamp') then
    create trigger pm_loans_stamp
      before insert or update on public.pm_loans
      for each row execute function public.pm_loans_stamp();
  end if;

  -- 3. Who may see and change a loan: the address that recorded it, while it
  --    is a super admin. member_role() already exists; it is used, not changed.
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'pm_loans' and policyname = 'pm_loans_select') then
    create policy pm_loans_select on public.pm_loans
      for select to authenticated
      using (public.member_role() = 'super_admin'
             and lower(owner_email) = lower(auth.jwt() ->> 'email'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'pm_loans' and policyname = 'pm_loans_insert') then
    create policy pm_loans_insert on public.pm_loans
      for insert to authenticated
      with check (public.member_role() = 'super_admin'
                  and lower(owner_email) = lower(auth.jwt() ->> 'email'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'pm_loans' and policyname = 'pm_loans_update') then
    create policy pm_loans_update on public.pm_loans
      for update to authenticated
      using (public.member_role() = 'super_admin'
             and lower(owner_email) = lower(auth.jwt() ->> 'email'))
      with check (public.member_role() = 'super_admin'
                  and lower(owner_email) = lower(auth.jwt() ->> 'email'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'pm_loans' and policyname = 'pm_loans_delete') then
    create policy pm_loans_delete on public.pm_loans
      for delete to authenticated
      using (public.member_role() = 'super_admin'
             and lower(owner_email) = lower(auth.jwt() ->> 'email'));
  end if;

  -- 4. The loans table's own grants: signed-in users, through the rules above;
  --    nobody signed out.
  revoke all on public.pm_loans from anon;
  grant select, insert, update, delete on public.pm_loans to authenticated;

  -- 5. The check. Anything outside pm_loans that is not exactly as it was
  --    undoes all of the above.
  after := array(select concat_ws(' :: ', kind, name, detail) from pg_temp.pm_loans_public_state() order by 1);
  if before is distinct from after then
    select string_agg(x, '; ') into diff from (
      (select unnest(after) as x except select unnest(before))
      union all
      (select unnest(before) as x except select unnest(after))
    ) changed;
    raise exception 'Stopped, and nothing was applied: something outside the loans table would have changed (%)',
      left(coalesce(diff, 'order changed'), 400);
  end if;
end
$loans$;

-- Tell the API about the new table. This only refreshes what the API knows
-- about; it changes nothing in the database.
notify pgrst, 'reload schema';

-- Should say: 1 | t | 4 | 1 | unchanged
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'pm_loans')                     as loans_table,
  (select relrowsecurity from pg_class where oid = 'public.pm_loans'::regclass)     as rls_on,
  (select count(*) from pg_policies where tablename = 'pm_loans')                  as loan_policies,
  (select count(*) from pg_trigger where tgname = 'pm_loans_stamp')                as stamp_trigger,
  'unchanged'::text                                                                as everything_else;
