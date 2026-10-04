-- Repairs a project where the visibility functions did not get created.
-- Safe to run more than once.

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

select
  (select count(*) from pg_proc where proname = 'effective_visibility') as effective_visibility,
  (select count(*) from pg_proc where proname = 'can_see_period')       as can_see_period,
  (select count(*) from pg_proc where proname = 'may_set_visibility')   as may_set_visibility,
  (select count(*) from pg_policies where tablename = 'periods')        as period_policies;
