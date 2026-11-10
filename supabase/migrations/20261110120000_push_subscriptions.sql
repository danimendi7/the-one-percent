-- E8 · Push subscriptions, one per device (PRD §5.3). Additive: one new table and four functions.
-- Published clients never call them.
--
-- A subscription is the address of one browser at its push service. Together with the server's
-- VAPID private key it lets the server wake that device, so no API client ever reads it back: the
-- table has RLS, no policies and no grants for anon or authenticated. Only the functions below touch
-- it. They are SECURITY DEFINER (like user_today()), check auth.uid() themselves, act only on the
-- caller's rows and return ids, labels and dates, never an endpoint or a key. The service role keeps
-- its access for a future server-side sender.
--
-- Each device subscribes and unsubscribes on its own: one row per endpoint, nothing shared between
-- rows. Unsubscribing deletes the row, so no key material outlives it.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Only real push services (Chrome/Android, Firefox, Safari/iOS, Edge): a sender never posts
  -- anywhere else. Mirrors isPushEndpoint (src/features/notifications/domain/push.ts).
  endpoint text not null unique
    check (char_length(endpoint) <= 2048
      and endpoint ~ '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/'),
  -- base64url public key (65 bytes) and auth secret (16 bytes) of the browser.
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}={0,2}$'),
  -- The server key the subscription was made with: after a key change it no longer works.
  vapid_key text not null check (vapid_key ~ '^[A-Za-z0-9_-]{80,100}={0,2}$'),
  label text not null check (char_length(label) between 1 and 60 and label = btrim(label)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id, created_at);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

-- Registers (or refreshes) the caller's device. An endpoint that belongs to another account (the
-- browser kept it from another session) is never handed over: the answer is 'taken' and the app
-- asks the browser for a new one.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_vapid_key text, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.push_subscriptions;
  v_label text := btrim(coalesce(p_label, ''));
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_row from public.push_subscriptions s where s.endpoint = p_endpoint for update;
  if found then
    if v_row.user_id <> v_uid then
      return jsonb_build_object('status', 'taken');
    end if;
    update public.push_subscriptions s
      set p256dh = p_p256dh, auth = p_auth, vapid_key = p_vapid_key, label = v_label, updated_at = now()
      where s.id = v_row.id;
    return jsonb_build_object('status', 'registered', 'id', v_row.id);
  end if;
  if (select count(*) from public.push_subscriptions s where s.user_id = v_uid) >= 20 then
    raise exception 'device_limit' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, vapid_key, label)
    values (v_uid, p_endpoint, p_p256dh, p_auth, p_vapid_key, v_label)
    on conflict (endpoint) do nothing
    returning * into v_row;
  if not found then
    -- Registered at the same moment by another request: report what is there now.
    select * into v_row from public.push_subscriptions s where s.endpoint = p_endpoint;
    if v_row.user_id <> v_uid then
      return jsonb_build_object('status', 'taken');
    end if;
    return jsonb_build_object('status', 'registered', 'id', v_row.id);
  end if;
  perform private.audit(v_uid, 'push_subscription', v_row.id, 'create', '{}'::jsonb);
  return jsonb_build_object('status', 'registered', 'id', v_row.id);
exception
  when check_violation or not_null_violation then
    raise exception 'invalid_value' using errcode = 'P0001';
end;
$$;

-- The caller's devices, oldest first. `current` marks the row of the endpoint given (this device).
create or replace function public.push_devices(p_endpoint text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'label', s.label, 'created_at', s.created_at, 'updated_at', s.updated_at,
             'current', p_endpoint is not null and s.endpoint = p_endpoint)
           order by s.created_at, s.id)
    from public.push_subscriptions s where s.user_id = v_uid), '[]'::jsonb);
end;
$$;

-- Removes one of the caller's devices by id (from the list, e.g. a lost phone). True if it existed.
create or replace function public.push_remove(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  delete from public.push_subscriptions s where s.id = p_id and s.user_id = v_uid;
  if not found then return false; end if;
  perform private.audit(v_uid, 'push_subscription', p_id, 'delete', '{}'::jsonb);
  return true;
end;
$$;

-- Removes the caller's device by its endpoint: the device unsubscribing itself, or a push service
-- that answered that the address no longer exists. True if it existed.
create or replace function public.push_forget(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = v_uid returning s.id into v_id;
  if v_id is null then return false; end if;
  perform private.audit(v_uid, 'push_subscription', v_id, 'delete', '{}'::jsonb);
  return true;
end;
$$;

revoke all on function public.push_subscribe(text, text, text, text, text) from public, anon;
revoke all on function public.push_devices(text) from public, anon;
revoke all on function public.push_remove(uuid) from public, anon;
revoke all on function public.push_forget(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text, text) to authenticated;
grant execute on function public.push_devices(text) to authenticated;
grant execute on function public.push_remove(uuid) to authenticated;
grant execute on function public.push_forget(text) to authenticated;
