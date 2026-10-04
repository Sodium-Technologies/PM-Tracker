-- Tries, inside the database, the exact write the app makes when a month is set
-- to "Only me" — as you, against your first month — and reports what happened.
--
-- It ends by raising the report as an error on purpose. Supabase's SQL Editor
-- only shows the last statement's result, and raising is also what guarantees
-- the test write is thrown away: NOTHING IS CHANGED, whatever it says.

do $probe$
declare
  me        text := 'nav8khan@gmail.com';
  target    record;
  outcome   text;
  my_role   text;
  may_hide  boolean;
  can_see   boolean;
begin
  select id, label, visibility, owner_email, data into target
  from public.periods order by label limit 1;
  if target.id is null then
    raise exception 'REPORT: there are no months in public.periods to test with.';
  end if;

  perform set_config('request.jwt.claims', json_build_object('email', me, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  my_role  := public.member_role();
  may_hide := public.may_set_visibility('private', jsonb_set(target.data, '{visibility}', '"private"'));
  can_see  := public.can_see_period(target.visibility, target.owner_email, target.data);

  begin
    insert into public.periods (id, label, data, visibility)
    values (target.id, target.label, jsonb_set(target.data, '{visibility}', '"private"'), 'private')
    on conflict (id) do update set data = excluded.data, visibility = excluded.visibility;
    outcome := 'the write WENT THROUGH';
  exception when others then
    outcome := 'the write was REFUSED: ' || sqlerrm;
  end;

  raise exception 'REPORT for "%" (% , owner %): role %, may hide %, can see it %; %',
    target.label, target.visibility, coalesce(target.owner_email, 'nobody'),
    coalesce(my_role, 'NONE'), may_hide, can_see, outcome;
end
$probe$;
