-- E9 · Scheduled push (PRD §5.2, Orden 2 §2). Additive: two extensions, one table, six functions and
-- one cron job. Published clients never see any of it.
--
-- Every 5 minutes pg_cron runs private.push_dispatch_tick(), which asks pg_net to POST to the app's
-- dispatch route (/api/push/dispatch). The route, with the service key, evaluates the Motivation
-- Engine for each person with a subscribed device (the same pure function as the in-app inbox, at
-- send time), reserves each reminder here before sending it and records how it went.
--
-- The target URL and its secret live in Vault, not here: until Dani stores them (docs/publicacion.md)
-- the tick does nothing. So staging never wakes production by accident, and the destination is
-- chosen when publishing. Free: pg_cron and pg_net are part of every Supabase project.
--
-- Deliveries are the shared record of what was sent (D of 2026-11-10): one row per person and
-- reminder key (rule + day, or rule + week for the review), so a retry, an overlapping run or two
-- runs at once can never send the same reminder twice. The daily cap and the minimum gap are checked
-- again when reserving, under a per-person lock. Like push_subscriptions, the table has RLS and no
-- grants for anon or authenticated, and the functions run only for the service role.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The Motivation Engine's idempotency key, e.g. 'late:2026-11-11' or 'review:2026-11-09'.
  nudge_key text not null check (char_length(nudge_key) between 1 and 80),
  rule text not null check (rule in ('morning', 'due', 'late', 'allDone', 'review', 'recall', 'focus')),
  -- Day and minute in the person's timezone when it was reserved (cap and spacing are per local day).
  local_date date not null,
  local_minutes integer not null check (local_minutes between 0 and 1439),
  -- reserved → sent (at least one device accepted) | failed (none did) | none (no device left).
  status text not null default 'reserved' check (status in ('reserved', 'sent', 'failed', 'none')),
  devices_ok integer not null default 0 check (devices_ok >= 0),
  devices_failed integer not null default 0 check (devices_failed >= 0),
  devices_gone integer not null default 0 check (devices_gone >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, nudge_key)
);
create index push_deliveries_user_day on public.push_deliveries (user_id, local_date);

alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public, anon, authenticated;

-- People with at least one subscribed device and reminders on, with what the engine needs besides
-- their data: timezone, recent deliveries (cap, spacing, already sent) and their devices.
create or replace function public.push_dispatch_users()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p.id,
           'timezone', p.timezone,
           'sent', (select coalesce(jsonb_agg(jsonb_build_object(
                             'key', d.nudge_key, 'rule', d.rule, 'at', d.created_at,
                             'localDate', d.local_date, 'minutes', d.local_minutes) order by d.created_at), '[]'::jsonb)
                    from public.push_deliveries d
                    where d.user_id = p.id and d.created_at > now() - interval '8 days'),
           'devices', (select jsonb_agg(jsonb_build_object(
                                'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'vapid_key', s.vapid_key)
                              order by s.created_at, s.id)
                       from public.push_subscriptions s where s.user_id = p.id))
         order by p.id), '[]'::jsonb)
  from public.profiles p
  where exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
    and coalesce(p.settings_json -> 'motivation' -> 'enabled', 'true'::jsonb) <> 'false'::jsonb
$$;

-- One person's data exactly as their own app receives it (a full pull_changes), so the server
-- evaluates the same state with the same code. auth.uid() reads the claims set here, for this
-- transaction only; nothing is written.
create or replace function public.push_dispatch_state(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_out jsonb;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    return null;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  v_out := public.pull_changes(0);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_out;
end;
$$;

-- Reserves a reminder before it is sent. Null when it must not go: already reserved (any status),
-- the day's cap reached, or another reminder less than p_gap minutes ago. Serialised per person.
create or replace function public.push_delivery_reserve(
  p_user uuid, p_key text, p_rule text, p_local_date date, p_minutes integer, p_cap integer, p_gap integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('push_delivery:' || p_user::text, 0));
  if exists (select 1 from public.push_deliveries d where d.user_id = p_user and d.nudge_key = p_key) then
    return null;
  end if;
  if (select count(*) from public.push_deliveries d where d.user_id = p_user and d.local_date = p_local_date) >= greatest(coalesce(p_cap, 0), 0) then
    return null;
  end if;
  if coalesce(p_gap, 0) > 0 and exists (
    select 1 from public.push_deliveries d where d.user_id = p_user and d.created_at > now() - make_interval(mins => p_gap)) then
    return null;
  end if;
  insert into public.push_deliveries (user_id, nudge_key, rule, local_date, local_minutes)
    values (p_user, p_key, p_rule, p_local_date, p_minutes)
    on conflict (user_id, nudge_key) do nothing
    returning id into v_id;
  return v_id;
end;
$$;

-- How a reserved reminder went. Only a reserved row changes, once.
create or replace function public.push_delivery_finish(p_id uuid, p_status text, p_ok integer, p_failed integer, p_gone integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_deliveries d
    set status = p_status, devices_ok = p_ok, devices_failed = p_failed, devices_gone = p_gone, updated_at = now()
    where d.id = p_id and d.status = 'reserved';
  return found;
end;
$$;

-- A push service answered that the address no longer exists (404/410): the device is gone.
create or replace function public.push_subscription_drop(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  delete from public.push_subscriptions s where s.id = p_id returning s.user_id into v_uid;
  if v_uid is null then return false; end if;
  perform private.audit(v_uid, 'push_subscription', p_id, 'delete', '{"reason":"gone"}'::jsonb);
  return true;
end;
$$;

revoke all on function public.push_dispatch_users() from public, anon, authenticated;
revoke all on function public.push_dispatch_state(uuid) from public, anon, authenticated;
revoke all on function public.push_delivery_reserve(uuid, text, text, date, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.push_delivery_finish(uuid, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.push_subscription_drop(uuid) from public, anon, authenticated;
grant execute on function public.push_dispatch_users() to service_role;
grant execute on function public.push_dispatch_state(uuid) to service_role;
grant execute on function public.push_delivery_reserve(uuid, text, text, date, integer, integer, integer) to service_role;
grant execute on function public.push_delivery_finish(uuid, text, integer, integer, integer) to service_role;
grant execute on function public.push_subscription_drop(uuid) to service_role;

-- The planner's tick: one POST to the dispatch route, if Vault holds its URL (https) and secret
-- (32+ characters, surrounding whitespace ignored). `push_dispatch_bypass`, optional, is Vercel's
-- protection bypass for a preview.
-- Returns the pg_net request id, or null when not configured.
create or replace function private.push_dispatch_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_bypass text;
  v_headers jsonb;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'push_dispatch_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'push_dispatch_secret';
  select s.decrypted_secret into v_bypass from vault.decrypted_secrets s where s.name = 'push_dispatch_bypass';
  -- A pasted value often carries a trailing newline: without trimming, the route (which trims its
  -- own copy) would answer 401 on every tick and nobody would notice.
  v_url := btrim(v_url, E' \t\r\n');
  v_secret := btrim(v_secret, E' \t\r\n');
  v_bypass := btrim(v_bypass, E' \t\r\n');
  if v_url is null or v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/\S*$' or v_secret is null or char_length(v_secret) < 32 then
    return null;
  end if;
  v_headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret);
  if v_bypass is not null and v_bypass <> '' then
    v_headers := v_headers || jsonb_build_object('x-vercel-protection-bypass', v_bypass);
  end if;
  return net.http_post(url := v_url, body := '{}'::jsonb, headers := v_headers, timeout_milliseconds := 25000);
end;
$$;
revoke all on function private.push_dispatch_tick() from public, anon, authenticated;

select cron.schedule('the-one-percent-push-dispatch', '*/5 * * * *', 'select private.push_dispatch_tick()');
