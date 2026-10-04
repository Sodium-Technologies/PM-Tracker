-- Installs the trigger that records who owns each month.
--
-- A project still carrying the original trigger — which stamps when a month was
-- last touched and by whom, but never its owner — refuses every attempt to set a
-- month to "Only me", even from its administrator, even on a month they own. The
-- app saves with an upsert, and before Postgres knows it is updating it checks
-- the row it would have inserted; without the trigger, that row is private and
-- owned by nobody, which nobody may see, so the write is refused.
--
-- Safe to run more than once.

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

-- Should say: yes
select case when pg_get_functiondef('public.touch_updated_at'::regproc) like '%owner_email%'
            then 'yes — the trigger now records owners' else 'NO — still the old trigger' end
       as owner_trigger_installed;
