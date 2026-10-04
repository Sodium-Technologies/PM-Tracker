-- Repairs a project where the visibility functions did not get created.
-- Safe to run more than once. The last line should read 1 | 1 | 1 | 4 | 1 | 0;
-- an owner_trigger of 0 means "Only me" will be refused for everyone.

create or replace function public.effective_visibility(visibility text, data jsonb)
returns text language sql immutable as $fn_vis$
  select case
    when coalesce(visibility, 'core') = 'private'
      or coalesce(data ->> 'visibility', 'core') = 'private' then 'private'
    when coalesce(visibility, 'core') = 'core'
      or coalesce(data ->> 'visibility', 'core') = 'core' then 'core'
    else 'public'
  end
$fn_vis$;

drop policy if exists periods_select on public.periods;
drop policy if exists periods_insert on public.periods;
drop policy if exists periods_update on public.periods;
drop policy if exists periods_delete on public.periods;
drop function if exists public.can_see_period(text, text);

create or replace function public.can_see_period(visibility text, owner_email text, data jsonb)
returns boolean language sql stable as $fn_see$
  select case public.effective_visibility(visibility, data)
    when 'public'  then public.member_role() is not null
    when 'core'    then public.member_role() in ('super_admin', 'editor')
    when 'private' then lower(coalesce(owner_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    else false
  end
$fn_see$;

-- Dropped by name, not replaced: an earlier version gave `data` a default, and
-- `create or replace` will not take a default away. The policies that use it are
-- dropped further up, so this is free to go.
drop function if exists public.may_set_visibility(text, jsonb);
create or replace function public.may_set_visibility(visibility text, data jsonb)
returns boolean language sql stable as $fn_may$
  select public.effective_visibility(visibility, data) <> 'private'
      or public.member_role() = 'super_admin'
$fn_may$;

create policy periods_select on public.periods
  for select to authenticated
  using (public.can_see_period(visibility, owner_email, data));

create policy periods_insert on public.periods
  for insert to authenticated
  with check (
    public.member_role() in ('super_admin', 'editor')
    and public.may_set_visibility(visibility, data)
  );

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

create policy periods_delete on public.periods
  for delete to authenticated
  using (
    public.member_role() in ('super_admin', 'editor')
    and public.can_see_period(visibility, owner_email, data)
  );

-- Who owns a month. Hiding one now makes the person hiding it its owner, which
-- is what "only me" has to mean — otherwise an administrator could see a month,
-- hide it, and be refused because the row named somebody else.
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

-- A private month with no owner is private to nobody: it cannot be read, and it
-- cannot be written either, because the policy that governs an update has to be
-- able to see the row first. Anything left without an owner goes to the first
-- administrator, which is the only address the database can work out by itself.
update public.periods p
set owner_email = (
  select u.email from public.app_users u
  where u.role = 'super_admin' order by u.created_at limit 1
)
where p.owner_email is null;

select
  (select count(*) from pg_proc where proname = 'effective_visibility') as effective_visibility,
  (select count(*) from pg_proc where proname = 'can_see_period')       as can_see_period,
  (select count(*) from pg_proc where proname = 'may_set_visibility')   as may_set_visibility,
  (select count(*) from pg_policies where tablename = 'periods')        as period_policies,
  (select count(*) from pg_trigger t join pg_proc f on f.oid = t.tgfoid
    where t.tgname = 'periods_touch' and f.prosrc like '%owner_email%')  as owner_trigger,
  (select count(*) from public.periods where owner_email is null)       as months_with_no_owner;
