#!/usr/bin/env bash
# Prove the row-level security in supabase/schema.sql against a real Postgres.
set -euo pipefail
PORT=${PGPORT:-5499}
Q() { psql -h /tmp -p "$PORT" -U postgres -X -q -t -A "$@"; }

# Errors are fatal here. psql carries on past a failed statement by default,
# which once hid a broken upgrade behind a wall of passing checks.
psql -h /tmp -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 -f scripts/rls-checks.sql >/dev/null
psql -h /tmp -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 -f supabase/schema.sql >/dev/null
Q -c "grant all on all tables in schema public to authenticated;" >/dev/null
Q -c "grant execute on all functions in schema public to authenticated;" >/dev/null

# Three people: the owner (also an administrator), a second administrator, and
# an editor. If "only me" means anything, the second administrator is the test.
Q -c "insert into public.app_users(email, role) values
      ('owner@example.com','super_admin'),
      ('other.admin@example.com','super_admin'),
      ('editor@example.com','editor'),
      ('viewer@example.com','viewer')
      on conflict (email) do update set role = excluded.role;" >/dev/null

# Months written as the owner, so the trigger stamps them to that address.
as() { Q -c "set local role authenticated; set local request.jwt.claims = '{\"email\":\"$1\"}'; $2"; }

Q -c "delete from public.periods;" >/dev/null
for v in private core public; do
  psql -h /tmp -p "$PORT" -U postgres -X -q -c "
    begin;
    set local role authenticated;
    set local request.jwt.claims = '{\"email\":\"owner@example.com\"}';
    insert into public.periods(id, label, data, visibility)
    values ('$v', '$v month', jsonb_build_object('visibility','$v'), '$v');
    commit;" >/dev/null
done

fails=0
check() { # who, expected ids
  got=$(psql -h /tmp -p "$PORT" -U postgres -X -q -t -A -c "
    begin;
    set local role authenticated;
    set local request.jwt.claims = '{\"email\":\"$1\"}';
    select coalesce(string_agg(id, ',' order by id), '-') from public.periods;
    commit;")
  if [ "$got" = "$2" ]; then echo "PASS  $1 sees $got"; else
    echo "FAIL  $1 sees [$got], expected [$2]"; fails=$((fails+1)); fi
}

echo "— who can see which month —"
check owner@example.com        "core,private,public"
check other.admin@example.com  "core,public"
check editor@example.com       "core,public"
check viewer@example.com       "public"
check nobody@example.com       "-"

echo
echo "— a column that disagrees with the saved month —"
# The write that set it private reached `data` but not the column: the stricter
# of the two has to win, or a failed write silently opens a month up.
Q -c "update public.periods set visibility = 'core',
      data = jsonb_build_object('visibility','private') where id = 'private';" >/dev/null
check other.admin@example.com  "core,public"
check owner@example.com        "core,private,public"

echo
echo "— and the other way round —"
Q -c "update public.periods set visibility = 'private',
      data = jsonb_build_object('visibility','core') where id = 'private';" >/dev/null
check other.admin@example.com  "core,public"

echo
echo "— writing —"
# The mutation runs as the person; the verification runs as the database owner,
# which row-level security does not apply to. Checking as the same person would
# prove nothing: the row is hidden from them either way, so a successful delete
# and a blocked one look identical.
mutate() { psql -h /tmp -p "$PORT" -U postgres -X -q -c "
  begin;
  set local role authenticated;
  set local request.jwt.claims = '{\"email\":\"$1\"}';
  $2;
  commit;" >/dev/null 2>&1 || true; }
truth() { Q -c "$1" | tail -1; }

mutate other.admin@example.com "update public.periods set label = 'stolen' where id = 'private'"
if [ "$(truth "select label from public.periods where id = 'private';")" = "private month" ]; then
  echo "PASS  another administrator cannot write over a private month"
else echo "FAIL  another administrator wrote over a private month"; fails=$((fails+1)); fi

mutate other.admin@example.com "delete from public.periods where id = 'private'"
if [ "$(truth "select count(*) from public.periods where id = 'private';")" = "1" ]; then
  echo "PASS  nor delete it"
else echo "FAIL  another administrator deleted a private month"; fails=$((fails+1)); fi

mutate editor@example.com "delete from public.periods where id = 'core'"
if [ "$(truth "select count(*) from public.periods where id = 'core';")" = "0" ]; then
  echo "PASS  but a month they may see, they may still delete"
else echo "FAIL  an editor could not delete a month they can see"; fails=$((fails+1)); fi

mutate owner@example.com "update public.periods set owner_email = 'other.admin@example.com' where id = 'private'"
if [ "$(truth "select owner_email from public.periods where id = 'private';")" = "owner@example.com" ]; then
  echo "PASS  ownership cannot be handed over by writing to the row"
else echo "FAIL  ownership was reassigned"; fails=$((fails+1)); fi

mutate viewer@example.com "update public.periods set label = 'by a viewer' where id = 'public'"
if [ "$(truth "select label from public.periods where id = 'public';")" = "public month" ]; then
  echo "PASS  a viewer cannot write, even to a month they can see"
else echo "FAIL  a viewer wrote to the books"; fails=$((fails+1)); fi

echo
echo "— who may hide a month —"
mutate owner@example.com "update public.periods set visibility = 'private', data = jsonb_build_object('visibility','private') where id = 'public'"
if [ "$(truth "select visibility from public.periods where id = 'public';")" = "private" ]; then
  echo "PASS  an administrator can hide a month"
else echo "FAIL  an administrator could not hide a month"; fails=$((fails+1)); fi
mutate owner@example.com "update public.periods set visibility = 'public', data = jsonb_build_object('visibility','public') where id = 'public'"

mutate editor@example.com "update public.periods set visibility = 'private', data = jsonb_build_object('visibility','private') where id = 'public'"
if [ "$(truth "select visibility from public.periods where id = 'public';")" = "public" ]; then
  echo "PASS  an editor cannot"
else echo "FAIL  an editor hid a month from the administrator"; fails=$((fails+1)); fi

mutate editor@example.com "insert into public.periods(id,label,data,visibility) values ('smuggled','smuggled',jsonb_build_object('visibility','private'),'core')"
if [ "$(truth "select count(*) from public.periods where id = 'smuggled';")" = "0" ]; then
  echo "PASS  nor smuggle one in with the column saying otherwise"
else echo "FAIL  an editor created a private month"; fails=$((fails+1)); fi

mutate editor@example.com "update public.periods set label = 'edited' where id = 'public'"
if [ "$(truth "select label from public.periods where id = 'public';")" = "edited" ]; then
  echo "PASS  but an editor can still keep the books"
else echo "FAIL  an editor could not edit a month"; fails=$((fails+1)); fi

echo
echo "— hiding a month somebody else is recorded as owning —"
# The case that reached an administrator in the field: a month they can see
# because it is shared with the core team, whose recorded owner is another
# address. Hiding it must make the administrator its owner, or the database
# refuses the very person asking.
Q -c "insert into public.periods(id,label,data,visibility,owner_email)
      values ('theirs','theirs','{\"visibility\":\"core\"}'::jsonb,'core','editor@example.com')
      on conflict (id) do update set visibility='core', data='{\"visibility\":\"core\"}', owner_email='editor@example.com';" >/dev/null
mutate owner@example.com "insert into public.periods(id,label,data,visibility) values ('theirs','theirs','{\"visibility\":\"private\"}'::jsonb,'private') on conflict (id) do update set data=excluded.data, visibility=excluded.visibility"
if [ "$(truth "select visibility || ' ' || owner_email from public.periods where id = 'theirs';")" = "private owner@example.com" ]; then
  echo "PASS  an administrator can hide it, and becomes its owner"
else echo "FAIL  hiding it was refused, or left the old owner: $(truth "select visibility || ' ' || coalesce(owner_email,'-') from public.periods where id = 'theirs';")"; fails=$((fails+1)); fi
seen=$(psql -h /tmp -p "$PORT" -U postgres -X -q -t -A -c "
  begin; set local role authenticated;
  set local request.jwt.claims = '{\"email\":\"editor@example.com\"}';
  select count(*) from public.periods where id = 'theirs'; commit;" | grep -E '^[0-9]+$')
if [ "$seen" = "0" ]; then echo "PASS  and the address it used to name can no longer see it"
else echo "FAIL  the previous owner can still see a month that was hidden"; fails=$((fails+1)); fi

# and it cannot be used to take a month away from somebody who hid it first
Q -c "insert into public.periods(id,label,data,visibility,owner_email)
      values ('hidden2','hidden2','{\"visibility\":\"private\"}'::jsonb,'private','other.admin@example.com')
      on conflict (id) do update set visibility='private', data='{\"visibility\":\"private\"}', owner_email='other.admin@example.com';" >/dev/null
mutate owner@example.com "update public.periods set label = 'taken' where id = 'hidden2'"
if [ "$(truth "select owner_email || ' ' || label from public.periods where id = 'hidden2';")" = "other.admin@example.com hidden2" ]; then
  echo "PASS  but not one another administrator has already hidden"
else echo "FAIL  an administrator took a month another had hidden"; fails=$((fails+1)); fi

# making a hidden month shared again does not move it
mutate owner@example.com "update public.periods set visibility = 'core', data = '{\"visibility\":\"core\"}' where id = 'theirs'"
if [ "$(truth "select visibility || ' ' || owner_email from public.periods where id = 'theirs';")" = "core owner@example.com" ]; then
  echo "PASS  and sharing it again leaves the owner as it was"
else echo "FAIL  sharing a hidden month changed its owner"; fails=$((fails+1)); fi

echo
[ "$fails" = "0" ] && echo "A private month is private." || { echo "$fails check(s) failed"; exit 1; }
