-- THE ONE PERCENT · M2 · 3/4 · Sync
-- Idempotent operation ledger, audit log, and the two sync RPCs:
--   apply_ops(device_id, ops)  → applies a batch of client operations exactly once
--   pull_changes(since)        → returns rows changed after a cursor (incl. tombstones)
-- Both run as SECURITY INVOKER, so every statement is still subject to RLS.

create table public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 64),
  client_op_id text not null check (char_length(client_op_id) between 8 and 100),
  operation_type text not null check (char_length(operation_type) <= 40),
  payload_hash text not null,
  outcome text not null check (outcome in ('applied', 'superseded', 'conflict', 'rejected')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, client_op_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  occurred_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb
);
create index audit_logs_user_time on public.audit_logs (user_id, occurred_at desc);

alter table public.sync_operations enable row level security;
alter table public.audit_logs enable row level security;

create policy "sync_ops: read own" on public.sync_operations for select to authenticated
  using (user_id = (select auth.uid()));
create policy "sync_ops: insert own" on public.sync_operations for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "audit: read own" on public.audit_logs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "audit: insert own" on public.audit_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Ledger and audit are append-only.
revoke all on public.sync_operations, public.audit_logs from anon;
revoke update, delete, truncate on public.sync_operations, public.audit_logs from authenticated;

-- ── Helpers ──────────────────────────────────────────────────────────────
create or replace function private.insert_version(p_uid uuid, p_habit uuid, p_from date, p_rule jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := p_rule ->> 'kind';
begin
  insert into public.habit_schedule_versions (habit_id, user_id, valid_from, schedule_kind, weekdays, target_count)
  values (
    p_habit, p_uid, p_from, v_kind,
    case when v_kind = 'weekdays'
      then (select array_agg(distinct x::smallint order by x::smallint) from jsonb_array_elements_text(p_rule -> 'weekdays') x)
    end,
    case when v_kind = 'weekly_count' then (p_rule ->> 'timesPerWeek')::smallint end
  );
end;
$$;

create or replace function private.same_rule(v public.habit_schedule_versions, p_rule jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select v.schedule_kind = p_rule ->> 'kind'
    and case p_rule ->> 'kind'
      when 'weekdays' then v.weekdays = (select array_agg(distinct x::smallint order by x::smallint) from jsonb_array_elements_text(p_rule -> 'weekdays') x)
      when 'weekly_count' then v.target_count = (p_rule ->> 'timesPerWeek')::smallint
      else true
    end;
$$;

create or replace function private.audit(p_uid uuid, p_type text, p_id uuid, p_action text, p_meta jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit_logs (user_id, entity_type, entity_id, action, metadata_json)
  values (p_uid, p_type, p_id, p_action, coalesce(p_meta, '{}'::jsonb));
$$;

-- Applies one operation. Raises P0001 with a stable code for validation errors.
create or replace function private.apply_op(p_uid uuid, p_type text, p_op jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_today date := public.user_today(p_uid);
  v_date date;
  v_ts timestamptz;
  v_value jsonb;
  v_habit_id uuid;
  v_entry public.habit_entries;
  v_habit public.habits;
  v_last public.habit_schedule_versions;
  v_dim uuid;
  v_patch jsonb;
  v_rule jsonb;
  v_from date;
  v_version jsonb;
  v_first date;
begin
  case p_type

  when 'entry.set' then
    v_habit_id := (p_op ->> 'habit_id')::uuid;
    v_date := (p_op ->> 'local_date')::date;
    v_ts := (p_op ->> 'client_updated_at')::timestamptz;
    v_value := p_op -> 'value';
    if v_ts is null then raise exception 'missing_client_time' using errcode = 'P0001'; end if;

    select * into v_entry from public.habit_entries e
      where e.user_id = p_uid and e.habit_id = v_habit_id and e.local_date = v_date
      for update;
    -- Last writer (by the user's own device time) wins; older intents do not overwrite newer ones.
    if found and v_entry.client_updated_at > v_ts then
      return jsonb_build_object('outcome', 'superseded');
    end if;

    if v_value is null or jsonb_typeof(v_value) = 'null' or v_value = 'false'::jsonb then
      -- Clearing always records a timestamped tombstone (even if nothing was set yet), so an
      -- older intent arriving later from another device cannot resurrect the value.
      insert into public.habit_entries (user_id, habit_id, local_date, client_op_id, client_updated_at, deleted_at)
      values (p_uid, v_habit_id, v_date, p_op ->> 'op_id', v_ts, now())
      on conflict (user_id, habit_id, local_date) do update
        set deleted_at = now(), value_bool = null, value_numeric = null,
            client_op_id = excluded.client_op_id, client_updated_at = excluded.client_updated_at;
    elsif jsonb_typeof(v_value) in ('boolean', 'number') then
      insert into public.habit_entries (user_id, habit_id, local_date, value_bool, value_numeric, client_op_id, client_updated_at)
      values (
        p_uid, v_habit_id, v_date,
        case when jsonb_typeof(v_value) = 'boolean' then (v_value #>> '{}')::boolean end,
        case when jsonb_typeof(v_value) = 'number' then (v_value #>> '{}')::numeric end,
        p_op ->> 'op_id', v_ts
      )
      on conflict (user_id, habit_id, local_date) do update
        set value_bool = excluded.value_bool,
            value_numeric = excluded.value_numeric,
            deleted_at = null,
            client_op_id = excluded.client_op_id,
            client_updated_at = excluded.client_updated_at;
    else
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;

    if v_date < v_today then
      perform private.audit(p_uid, 'habit_entry', v_habit_id, 'backfill',
        jsonb_build_object('local_date', v_date, 'value', v_value));
    end if;
    return jsonb_build_object('outcome', 'applied');

  when 'habit.create' then
    v_habit_id := (p_op #>> '{habit,id}')::uuid;
    select d.id into v_dim from public.dimensions d
      where d.user_id = p_uid and d.slug = p_op #>> '{habit,dimension}';
    if v_dim is null then raise exception 'invalid_dimension' using errcode = 'P0001'; end if;

    insert into public.habits (id, user_id, dimension_id, title, icon, habit_type, unit, target_value, target_direction, start_date)
    values (
      v_habit_id, p_uid, v_dim,
      btrim(p_op #>> '{habit,title}'),
      coalesce(p_op #>> '{habit,icon}', 'check'),
      p_op #>> '{habit,habit_type}',
      nullif(p_op #>> '{habit,unit}', ''),
      (p_op #>> '{habit,target_value}')::numeric,
      p_op #>> '{habit,target_direction}',
      (p_op #>> '{habit,start_date}')::date
    )
    on conflict (id) do nothing;

    if not found then
      -- Same id already present: idempotent if it is ours, otherwise refuse.
      if exists (select 1 from public.habits h where h.id = v_habit_id and h.user_id = p_uid) then
        return jsonb_build_object('outcome', 'applied', 'existing', true);
      end if;
      raise exception 'id_conflict' using errcode = 'P0001';
    end if;

    if jsonb_typeof(p_op -> 'versions') <> 'array' or jsonb_array_length(p_op -> 'versions') = 0 then
      raise exception 'missing_schedule' using errcode = 'P0001';
    end if;
    for v_version in select * from jsonb_array_elements(p_op -> 'versions') loop
      perform private.insert_version(p_uid, v_habit_id, (v_version ->> 'valid_from')::date, v_version -> 'rule');
    end loop;
    select min(v.valid_from) into v_first from public.habit_schedule_versions v where v.habit_id = v_habit_id;
    if v_first <> (p_op #>> '{habit,start_date}')::date then
      raise exception 'first_version_must_match_start' using errcode = 'P0001';
    end if;

    perform private.audit(p_uid, 'habit', v_habit_id, 'create', jsonb_build_object('title', p_op #>> '{habit,title}'));
    return jsonb_build_object('outcome', 'applied');

  when 'habit.update' then
    v_habit_id := (p_op ->> 'habit_id')::uuid;
    select * into v_habit from public.habits h where h.id = v_habit_id and h.user_id = p_uid for update;
    if not found then raise exception 'habit_not_found' using errcode = 'P0001'; end if;
    -- Edited on another device since this client last saw it: report, do not overwrite.
    if v_habit.version <> (p_op ->> 'base_version')::int then
      return jsonb_build_object('outcome', 'conflict', 'current_version', v_habit.version);
    end if;

    v_patch := coalesce(p_op -> 'patch', '{}'::jsonb);
    if v_patch ? 'dimension' then
      select d.id into v_dim from public.dimensions d where d.user_id = p_uid and d.slug = v_patch ->> 'dimension';
      if v_dim is null then raise exception 'invalid_dimension' using errcode = 'P0001'; end if;
    end if;

    update public.habits h set
      title = coalesce(btrim(v_patch ->> 'title'), h.title),
      icon = coalesce(v_patch ->> 'icon', h.icon),
      dimension_id = coalesce(v_dim, h.dimension_id),
      unit = case when h.habit_type <> 'binary' and v_patch ? 'unit' then nullif(v_patch ->> 'unit', '') else h.unit end,
      target_value = case when h.habit_type <> 'binary' and v_patch ? 'target_value' then (v_patch ->> 'target_value')::numeric else h.target_value end,
      target_direction = case when h.habit_type <> 'binary' and v_patch ? 'target_direction' then v_patch ->> 'target_direction' else h.target_direction end,
      version = h.version + 1
    where h.id = v_habit_id;

    if p_op ? 'schedule' then
      v_from := (p_op #>> '{schedule,effective_from}')::date;
      v_rule := p_op #> '{schedule,rule}';
      -- Schedule changes apply from today (±1 day of timezone slack), never retroactively.
      if v_from is null or v_from < v_today - 1 or v_from > v_today + 1 then
        raise exception 'invalid_effective_date' using errcode = 'P0001';
      end if;
      v_from := greatest(v_from, v_habit.start_date);
      delete from public.habit_schedule_versions v where v.habit_id = v_habit_id and v.valid_from >= v_from;
      select * into v_last from public.habit_schedule_versions v
        where v.habit_id = v_habit_id order by v.valid_from desc limit 1;
      if not found or not private.same_rule(v_last, v_rule) then
        perform private.insert_version(p_uid, v_habit_id, v_from, v_rule);
      end if;
    end if;

    perform private.audit(p_uid, 'habit', v_habit_id, 'update', v_patch || jsonb_build_object('schedule', p_op -> 'schedule'));
    return jsonb_build_object('outcome', 'applied');

  when 'habit.archive' then
    v_habit_id := (p_op ->> 'habit_id')::uuid;
    v_date := (p_op ->> 'archived_on')::date;
    if v_date is null or v_date < v_today - 1 or v_date > v_today + 1 then
      raise exception 'invalid_archive_date' using errcode = 'P0001';
    end if;
    update public.habits h set archived_on = greatest(v_date, h.start_date), version = h.version + 1
      where h.id = v_habit_id and h.user_id = p_uid;
    if not found then raise exception 'habit_not_found' using errcode = 'P0001'; end if;
    perform private.audit(p_uid, 'habit', v_habit_id, 'archive', jsonb_build_object('archived_on', v_date));
    return jsonb_build_object('outcome', 'applied');

  when 'habit.restore' then
    v_habit_id := (p_op ->> 'habit_id')::uuid;
    update public.habits h set archived_on = null, version = h.version + 1
      where h.id = v_habit_id and h.user_id = p_uid;
    if not found then raise exception 'habit_not_found' using errcode = 'P0001'; end if;
    perform private.audit(p_uid, 'habit', v_habit_id, 'restore', '{}'::jsonb);
    return jsonb_build_object('outcome', 'applied');

  when 'rest_day.set' then
    v_date := (p_op ->> 'local_date')::date;
    v_ts := (p_op ->> 'client_updated_at')::timestamptz;
    if v_ts is null then raise exception 'missing_client_time' using errcode = 'P0001'; end if;
    insert into public.routine_calendar (user_id, local_date, rest_flag, client_updated_at)
    values (p_uid, v_date, coalesce((p_op ->> 'rest')::boolean, false), v_ts)
    on conflict (user_id, local_date) do update
      set rest_flag = excluded.rest_flag, client_updated_at = excluded.client_updated_at
      where public.routine_calendar.client_updated_at <= excluded.client_updated_at;
    if not found then
      return jsonb_build_object('outcome', 'superseded');
    end if;
    return jsonb_build_object('outcome', 'applied');

  when 'profile.update' then
    if p_op ? 'timezone' then
      if not private.is_valid_timezone(p_op ->> 'timezone') then
        raise exception 'invalid_timezone' using errcode = 'P0001';
      end if;
      update public.profiles p set timezone = p_op ->> 'timezone' where p.id = p_uid;
    end if;
    return jsonb_build_object('outcome', 'applied');

  else
    raise exception 'unknown_op_type' using errcode = 'P0001';
  end case;
end;
$$;

-- ── apply_ops ─────────────────────────────────────────────────────────────
create or replace function public.apply_ops(p_device_id text, p_ops jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_op jsonb;
  v_id text;
  v_type text;
  v_prev public.sync_operations;
  v_result jsonb;
  v_outcome text;
  v_results jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 100 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;

  for v_op in select value from jsonb_array_elements(p_ops) loop
    v_id := v_op ->> 'op_id';
    v_type := v_op ->> 'type';

    if v_id is null or char_length(v_id) not between 8 and 100 then
      v_results := v_results || jsonb_build_array(jsonb_build_object('op_id', v_id, 'status', 'rejected', 'code', 'invalid_op_id'));
      continue;
    end if;

    -- Idempotency: an operation id is applied at most once; replays return the stored outcome.
    select * into v_prev from public.sync_operations s where s.user_id = v_uid and s.client_op_id = v_id;
    if found then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'op_id', v_id, 'status', 'duplicate', 'outcome', v_prev.outcome, 'code', v_prev.result ->> 'code'));
      continue;
    end if;

    begin
      v_result := private.apply_op(v_uid, v_type, v_op);
      v_outcome := v_result ->> 'outcome';
    exception
      when sqlstate 'P0001' or foreign_key_violation or unique_violation or check_violation
        or not_null_violation or invalid_text_representation or invalid_datetime_format
        or datetime_field_overflow or numeric_value_out_of_range or invalid_parameter_value then
        -- Validation failures are deterministic: record them so replays answer the same.
        v_outcome := 'rejected';
        v_result := jsonb_build_object('outcome', 'rejected', 'code', sqlerrm, 'sqlstate', sqlstate);
    end;

    insert into public.sync_operations (user_id, device_id, client_op_id, operation_type, payload_hash, outcome, result)
    values (v_uid, left(coalesce(nullif(p_device_id, ''), 'unknown'), 64), v_id, left(coalesce(v_type, 'unknown'), 40),
            md5(v_op::text), v_outcome, v_result);

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'op_id', v_id, 'status', v_outcome, 'code', v_result ->> 'code'));
  end loop;

  return jsonb_build_object('results', v_results, 'server_today', public.user_today(v_uid));
end;
$$;

-- ── pull_changes ─────────────────────────────────────────────────────────
create or replace function public.pull_changes(p_since bigint default 0)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_since bigint := greatest(coalesce(p_since, 0), 0);
  v_full boolean := coalesce(p_since, 0) <= 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return jsonb_build_object(
    'server_today', public.user_today(v_uid),
    'full', v_full,
    'profile', (select jsonb_build_object('timezone', p.timezone, 'locale', p.locale, 'server_seq', p.server_seq)
                from public.profiles p where p.id = v_uid),
    'dimensions', (select coalesce(jsonb_agg(jsonb_build_object('slug', d.slug, 'name', d.name) order by d.sort_order), '[]'::jsonb)
                   from public.dimensions d where d.user_id = v_uid and d.archived_at is null),
    'habits', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', h.id, 'title', h.title, 'icon', h.icon, 'dimension', d.slug,
                  'habit_type', h.habit_type, 'unit', h.unit, 'target_value', h.target_value,
                  'target_direction', h.target_direction, 'start_date', h.start_date,
                  'archived_on', h.archived_on, 'version', h.version, 'created_at', h.created_at,
                  'server_seq', h.server_seq,
                  -- Full version list: superseded versions disappear here, so other devices converge.
                  'versions', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'valid_from', v.valid_from, 'kind', v.schedule_kind,
                                  'weekdays', v.weekdays, 'target_count', v.target_count) order by v.valid_from), '[]'::jsonb)
                               from public.habit_schedule_versions v where v.habit_id = h.id)
                ) order by h.created_at), '[]'::jsonb)
               from public.habits h join public.dimensions d on d.id = h.dimension_id
               where h.user_id = v_uid and h.server_seq > v_since),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                   'habit_id', e.habit_id, 'local_date', e.local_date,
                   'value_bool', e.value_bool, 'value_numeric', e.value_numeric,
                   'deleted', e.deleted_at is not null, 'client_op_id', e.client_op_id,
                   'client_updated_at', e.client_updated_at, 'server_seq', e.server_seq)), '[]'::jsonb)
                from public.habit_entries e
                where e.user_id = v_uid and e.server_seq > v_since and (not v_full or e.deleted_at is null)),
    'rest_days', (select coalesce(jsonb_agg(jsonb_build_object(
                     'local_date', r.local_date, 'rest', r.rest_flag,
                     'client_updated_at', r.client_updated_at, 'server_seq', r.server_seq)), '[]'::jsonb)
                  from public.routine_calendar r
                  where r.user_id = v_uid and r.server_seq > v_since and (not v_full or r.rest_flag)),
    'cursor', greatest(v_since,
      coalesce((select max(h.server_seq) from public.habits h where h.user_id = v_uid), 0),
      coalesce((select max(e.server_seq) from public.habit_entries e where e.user_id = v_uid), 0),
      coalesce((select max(r.server_seq) from public.routine_calendar r where r.user_id = v_uid), 0),
      coalesce((select p.server_seq from public.profiles p where p.id = v_uid), 0))
  );
end;
$$;

revoke all on function public.apply_ops(text, jsonb) from public, anon;
revoke all on function public.pull_changes(bigint) from public, anon;
grant execute on function public.apply_ops(text, jsonb) to authenticated;
grant execute on function public.pull_changes(bigint) to authenticated;
revoke all on function public.habit_is_eligible(uuid, date) from public, anon;
grant execute on function public.habit_is_eligible(uuid, date) to authenticated;
