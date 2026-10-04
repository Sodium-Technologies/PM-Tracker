-- Lists the rules installed on public.periods: every policy, the trigger, and
-- the functions they call. One result, read-only.
select 'POLICY ' || policyname || ' (' || cmd || ', ' || permissive || ', to ' || array_to_string(roles, ',') || ')'
       || ' USING ' || coalesce(qual, '-') || ' CHECK ' || coalesce(with_check, '-') as what_is_installed
from pg_policies where schemaname = 'public' and tablename = 'periods'
union all
select 'TRIGGER ' || tgname || ' calls ' || tgfoid::regproc::text || case when tgenabled = 'D' then ' (DISABLED)' else '' end
from pg_trigger where tgrelid = 'public.periods'::regclass and not tgisinternal
union all
select 'FUNCTION ' || p.oid::regprocedure::text || ' -> ' || regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('member_role', 'effective_visibility', 'can_see_period', 'may_set_visibility', 'touch_updated_at')
union all
select 'RLS on periods: ' || relrowsecurity || ', forced: ' || relforcerowsecurity
from pg_class where oid = 'public.periods'::regclass;
