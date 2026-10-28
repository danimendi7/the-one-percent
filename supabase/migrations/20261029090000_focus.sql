-- THE ONE PERCENT · M3.2 · Deep Work (docs/m3.2-deep-work-plan.md)
-- Focus sessions over the existing sync engine (apply_ops idempotency ledger, pull_changes
-- cursor, realtime invalidation). A session's time is the sum of its segments (wall-clock
-- instants); the server recomputes active_seconds and local_date from them, so the client never
-- sends a counter. A duration habit can be fed by sessions: its day is materialised here, in the
-- same transaction, and manual entries for it are refused (derived_entry). Additive only:
-- existing tables gain nullable columns, no data is rewritten. No hard deletes.

-- ── Habits fed by focus ──────────────────────────────────────────────────
alter table public.habits
  add column activity_source text check (activity_source in ('focus')),
  add column activity_source_from date,
  add constraint habits_activity_source_shape check (
    (activity_source is null) = (activity_source_from is null)
    and (activity_source is null or habit_type = 'duration')
  );

-- ── Sessions ─────────────────────────────────────────────────────────────
create table public.focus_sessions (
  -- Client-generated UUID so creation is idempotent across retries and devices.
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id uuid,
  project text check (char_length(btrim(project)) between 1 and 60),
  planned_output text check (char_length(planned_output) <= 200),
  actual_output text check (char_length(actual_output) <= 500),
  planned_minutes smallint not null check (planned_minutes between 1 and 720),
  -- [{start, end|null}] ISO instants; only the last segment of a running session is open.
  segments jsonb not null,
  state text not null check (state in ('running', 'paused', 'finished')),
  -- Derived by the guard from segments and the profile timezone (never trusted from clients).
  started_at timestamptz not null,
  ended_at timestamptz,
  active_seconds integer not null default 0 check (active_seconds between 0 and 43200),
  local_date date not null,
  rating smallint check (rating between 1 and 5),
  version integer not null default 1 check (version >= 1),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default nextval('public.change_seq'),
  unique (id, user_id),
  foreign key (habit_id, user_id) references public.habits (id, user_id),
  constraint focus_finished_has_end check ((state = 'finished') = (ended_at is not null))
);
-- Decision 5: one active session per user, shared between devices.
create unique index focus_sessions_one_active on public.focus_sessions (user_id)
  where state <> 'finished' and deleted_at is null;
create index focus_sessions_user_seq on public.focus_sessions (user_id, server_seq);
create index focus_sessions_habit_user on public.focus_sessions (habit_id, user_id);
create index focus_sessions_habit_day on public.focus_sessions (user_id, habit_id, local_date);

create trigger focus_sessions_touch before insert or update on public.focus_sessions
  for each row execute function private.touch_row();

-- ISO-8601 UTC with milliseconds: the exact format clients write and parse.
create or replace function private.iso(p_ts timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- ── Integrity guards ─────────────────────────────────────────────────────
-- Mirrors validateSegments() in src/features/focus/domain/time.ts.
create or replace function private.guard_focus_session()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_seg jsonb;
  v_n int;
  v_i int := 0;
  v_start timestamptz;
  v_end timestamptz;
  v_prev timestamptz;
  v_total numeric := 0;
  v_tz text;
  v_type text;
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.id <> old.id) then
    raise exception 'immutable_identity' using errcode = 'P0001';
  end if;
  if jsonb_typeof(new.segments) is distinct from 'array' then
    raise exception 'segments_empty' using errcode = 'P0001';
  end if;
  v_n := jsonb_array_length(new.segments);
  if v_n = 0 then raise exception 'segments_empty' using errcode = 'P0001'; end if;
  if v_n > 200 then raise exception 'too_many_segments' using errcode = 'P0001'; end if;

  for v_seg in select value from jsonb_array_elements(new.segments) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_seg) is distinct from 'object' or jsonb_typeof(v_seg -> 'start') is distinct from 'string' then
      raise exception 'segments_order' using errcode = 'P0001';
    end if;
    v_start := (v_seg ->> 'start')::timestamptz;
    v_end := (v_seg ->> 'end')::timestamptz;
    if v_end is null then
      if v_i < v_n or new.state <> 'running' then raise exception 'segments_open' using errcode = 'P0001'; end if;
    elsif v_i = v_n and new.state = 'running' then
      raise exception 'segments_open' using errcode = 'P0001';
    end if;
    if v_end < v_start then raise exception 'segments_order' using errcode = 'P0001'; end if;
    if v_prev is not null and v_start < v_prev then raise exception 'segments_overlap' using errcode = 'P0001'; end if;
    if greatest(v_start, coalesce(v_end, v_start)) > clock_timestamp() + interval '60 seconds' then
      raise exception 'segments_future' using errcode = 'P0001';
    end if;
    if v_end is not null then v_total := v_total + extract(epoch from v_end - v_start); end if;
    v_prev := coalesce(v_end, v_start);
  end loop;
  if v_total > 43200 then raise exception 'segments_too_long' using errcode = 'P0001'; end if;

  new.active_seconds := round(v_total)::int;
  new.started_at := (new.segments -> 0 ->> 'start')::timestamptz;
  new.ended_at := case when new.state = 'finished' then (new.segments -> (v_n - 1) ->> 'end')::timestamptz end;
  -- Decision 2: the day it STARTED, in the profile's timezone.
  select p.timezone into v_tz from public.profiles p where p.id = new.user_id;
  new.local_date := (new.started_at at time zone coalesce(v_tz, 'Europe/Madrid'))::date;

  if new.habit_id is not null then
    select h.habit_type into v_type from public.habits h where h.id = new.habit_id and h.user_id = new.user_id;
    if v_type is distinct from 'duration' then raise exception 'invalid_habit' using errcode = 'P0001'; end if;
  end if;
  if new.state = 'finished' and new.deleted_at is null and new.active_seconds < 60 then
    raise exception 'too_short' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger focus_sessions_guard before insert or update on public.focus_sessions
  for each row execute function private.guard_focus_session();

-- Decision 1: from activity_source_from on, a fed habit's entries are written only by
-- focus_rederive (which raises a transaction-local flag around its own write).
create or replace function private.guard_focus_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('top.focus_derive', true), 'off') = 'on' then
    return new;
  end if;
  if exists (
    select 1 from public.habits h
    where h.id = new.habit_id and h.user_id = new.user_id
      and h.activity_source = 'focus' and new.local_date >= h.activity_source_from
  ) then
    raise exception 'derived_entry' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger habit_entries_focus_guard before insert or update on public.habit_entries
  for each row execute function private.guard_focus_entry();

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.focus_sessions enable row level security;

create policy "focus: read own" on public.focus_sessions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "focus: insert own" on public.focus_sessions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "focus: update own" on public.focus_sessions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.focus_sessions from anon;
revoke delete, truncate on public.focus_sessions from authenticated;

alter publication supabase_realtime add table public.focus_sessions;

-- ── Derived habit day ────────────────────────────────────────────────────
-- Mirrors rederive() in src/features/focus/domain/ops.ts: minutes = round(Σ active_seconds / 60)
-- of the finished sessions linked to the habit that day; nothing on unscheduled or rest days.
create or replace function private.focus_rederive(p_uid uuid, p_habit uuid, p_date date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_h public.habits;
  v_min numeric;
begin
  if p_habit is null or p_date is null then return; end if;
  select * into v_h from public.habits h where h.id = p_habit and h.user_id = p_uid;
  if not found or v_h.activity_source is distinct from 'focus' or p_date < v_h.activity_source_from then
    return;
  end if;
  select round(coalesce(sum(f.active_seconds), 0) / 60.0) into v_min
    from public.focus_sessions f
    where f.user_id = p_uid and f.habit_id = p_habit and f.local_date = p_date
      and f.state = 'finished' and f.deleted_at is null;

  perform set_config('top.focus_derive', 'on', true);
  if v_min > 0 and p_date <= public.user_today(p_uid) and public.habit_is_eligible(p_habit, p_date)
     and not exists (select 1 from public.routine_calendar r where r.user_id = p_uid and r.local_date = p_date and r.rest_flag) then
    insert into public.habit_entries (user_id, habit_id, local_date, value_numeric, source_activity_type, client_op_id, client_updated_at)
    values (p_uid, p_habit, p_date, v_min, 'focus_session', 'focus:' || gen_random_uuid(), clock_timestamp())
    on conflict (user_id, habit_id, local_date) do update
      set value_numeric = excluded.value_numeric, value_bool = null, deleted_at = null,
          source_activity_type = 'focus_session', client_op_id = excluded.client_op_id,
          client_updated_at = excluded.client_updated_at
      where public.habit_entries.value_numeric is distinct from excluded.value_numeric
         or public.habit_entries.deleted_at is not null;
  else
    update public.habit_entries e
      set deleted_at = now(), value_numeric = null, value_bool = null, source_activity_type = 'focus_session',
          client_op_id = 'focus:' || gen_random_uuid(), client_updated_at = clock_timestamp()
      where e.user_id = p_uid and e.habit_id = p_habit and e.local_date = p_date and e.deleted_at is null;
  end if;
  perform set_config('top.focus_derive', 'off', true);
end;
$$;

-- ── Operations ───────────────────────────────────────────────────────────
create or replace function private.apply_focus_op(p_uid uuid, p_type text, p_op jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := coalesce((p_op ->> 'session_id')::uuid, (p_op #>> '{session,id}')::uuid);
  v_s public.focus_sessions;
  v_at timestamptz;
  v_trim timestamptz;
  v_n int;
  v_last jsonb;
  v_segs jsonb;
  v_cut jsonb := '[]'::jsonb;
  v_seg jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_old_habit uuid;
  v_old_date date;
  v_active uuid;
  v_today date := public.user_today(p_uid);
  v_from date;
  v_source text;
  v_habit public.habits;
begin
  -- Action times never go beyond "now" (+1 min of slack): a clock running ahead cannot inflate minutes.
  v_at := least(coalesce((p_op ->> 'at')::timestamptz, clock_timestamp()), clock_timestamp() + interval '1 minute');

  case p_type

  when 'focus.start' then
    if exists (select 1 from public.focus_sessions f where f.id = v_id and f.user_id = p_uid) then
      return jsonb_build_object('outcome', 'applied', 'existing', true);
    end if;
    select f.id into v_active from public.focus_sessions f
      where f.user_id = p_uid and f.state <> 'finished' and f.deleted_at is null;
    if found then
      -- Two devices starting at once: the first to reach the server wins; the other joins it.
      return jsonb_build_object('outcome', 'conflict', 'code', 'session_active', 'active_id', v_active);
    end if;
    v_at := least(coalesce((p_op #>> '{session,started_at}')::timestamptz, clock_timestamp()), clock_timestamp() + interval '1 minute');
    begin
      insert into public.focus_sessions (id, user_id, habit_id, project, planned_output, planned_minutes, segments, state, started_at, local_date)
      values (
        v_id, p_uid, (p_op #>> '{session,habit_id}')::uuid,
        nullif(btrim(coalesce(p_op #>> '{session,project}', '')), ''),
        nullif(btrim(coalesce(p_op #>> '{session,planned_output}', '')), ''),
        (p_op #>> '{session,planned_minutes}')::smallint,
        jsonb_build_array(jsonb_build_object('start', private.iso(v_at), 'end', null)),
        'running', v_at, v_today
      );
    exception when unique_violation then
      -- Lost a race with another device of this user: report the active session. Otherwise the id
      -- belongs to someone else (invisible under RLS): refuse it.
      if exists (select 1 from public.focus_sessions f where f.user_id = p_uid and f.state <> 'finished' and f.deleted_at is null) then
        return jsonb_build_object('outcome', 'conflict', 'code', 'session_active');
      end if;
      raise exception 'id_conflict' using errcode = 'P0001';
    end;
    perform private.audit(p_uid, 'focus_session', v_id, 'start', '{}'::jsonb);
    return jsonb_build_object('outcome', 'applied');

  when 'focus.pause', 'focus.resume', 'focus.finish' then
    select * into v_s from public.focus_sessions f where f.id = v_id and f.user_id = p_uid for update;
    if not found then raise exception 'session_not_found' using errcode = 'P0001'; end if;
    -- Discarded or finished on another device meanwhile: nothing to do, not an error.
    if v_s.deleted_at is not null or v_s.state = 'finished' then
      return jsonb_build_object('outcome', 'superseded', 'code', 'not_active');
    end if;
    v_n := jsonb_array_length(v_s.segments);
    v_last := v_s.segments -> (v_n - 1);
    v_segs := v_s.segments;

    if p_type = 'focus.resume' then
      if v_s.state = 'running' then return jsonb_build_object('outcome', 'applied'); end if;
      v_at := greatest(v_at, (v_last ->> 'end')::timestamptz);
      update public.focus_sessions f
        set segments = v_segs || jsonb_build_array(jsonb_build_object('start', private.iso(v_at), 'end', null)),
            state = 'running', version = f.version + 1
        where f.id = v_id;
      return jsonb_build_object('outcome', 'applied');
    end if;

    if v_s.state = 'running' then
      v_at := greatest(v_at, (v_last ->> 'start')::timestamptz);
      v_segs := jsonb_set(v_segs, array[(v_n - 1)::text, 'end'], to_jsonb(private.iso(v_at)));
    end if;
    if p_type = 'focus.pause' then
      if v_s.state = 'paused' then return jsonb_build_object('outcome', 'applied'); end if;
      update public.focus_sessions f set segments = v_segs, state = 'paused', version = f.version + 1 where f.id = v_id;
      return jsonb_build_object('outcome', 'applied');
    end if;

    -- focus.finish: optional cut («Terminar a las HH:MM» or minutes lowered at close).
    v_trim := (p_op ->> 'trim_to')::timestamptz;
    -- Mirrors trimSegments(): later segments are dropped, the one in progress ends at the cut.
    if v_trim is not null then
      for v_seg in select value from jsonb_array_elements(v_segs) loop
        v_start := (v_seg ->> 'start')::timestamptz;
        exit when v_start >= v_trim;
        v_end := least((v_seg ->> 'end')::timestamptz, v_trim);
        v_cut := v_cut || jsonb_build_array(jsonb_build_object('start', v_seg ->> 'start', 'end', private.iso(v_end)));
      end loop;
      v_segs := case when jsonb_array_length(v_cut) = 0
        then jsonb_build_array(jsonb_build_object('start', v_segs -> 0 ->> 'start', 'end', v_segs -> 0 ->> 'start'))
        else v_cut end;
    end if;
    update public.focus_sessions f set
      segments = v_segs, state = 'finished',
      actual_output = nullif(btrim(coalesce(p_op ->> 'actual_output', '')), ''),
      rating = (p_op ->> 'rating')::smallint,
      version = f.version + 1
    where f.id = v_id
    returning * into v_s;
    perform private.focus_rederive(p_uid, v_s.habit_id, v_s.local_date);
    perform private.audit(p_uid, 'focus_session', v_id, 'finish', jsonb_build_object('active_seconds', v_s.active_seconds));
    return jsonb_build_object('outcome', 'applied');

  when 'focus.edit' then
    select * into v_s from public.focus_sessions f where f.id = v_id and f.user_id = p_uid for update;
    if not found or v_s.deleted_at is not null then raise exception 'session_not_found' using errcode = 'P0001'; end if;
    if v_s.state <> 'finished' then raise exception 'not_finished' using errcode = 'P0001'; end if;
    -- Edited on another device since this client last saw it: report, do not overwrite.
    if v_s.version <> (p_op ->> 'base_version')::int then
      return jsonb_build_object('outcome', 'conflict', 'current_version', v_s.version);
    end if;
    v_old_habit := v_s.habit_id;
    v_old_date := v_s.local_date;
    update public.focus_sessions f set
      segments = p_op -> 'segments',
      habit_id = (p_op ->> 'habit_id')::uuid,
      project = nullif(btrim(coalesce(p_op ->> 'project', '')), ''),
      planned_output = nullif(btrim(coalesce(p_op ->> 'planned_output', '')), ''),
      actual_output = nullif(btrim(coalesce(p_op ->> 'actual_output', '')), ''),
      rating = (p_op ->> 'rating')::smallint,
      version = f.version + 1
    where f.id = v_id
    returning * into v_s;
    perform private.focus_rederive(p_uid, v_old_habit, v_old_date);
    perform private.focus_rederive(p_uid, v_s.habit_id, v_s.local_date);
    perform private.audit(p_uid, 'focus_session', v_id, 'edit', '{}'::jsonb);
    return jsonb_build_object('outcome', 'applied');

  when 'focus.discard' then
    update public.focus_sessions f set deleted_at = now(), version = f.version + 1
      where f.id = v_id and f.user_id = p_uid and f.deleted_at is null
      returning * into v_s;
    if found then
      if v_s.state = 'finished' then perform private.focus_rederive(p_uid, v_s.habit_id, v_s.local_date); end if;
      perform private.audit(p_uid, 'focus_session', v_id, 'discard', '{}'::jsonb);
    elsif not exists (select 1 from public.focus_sessions f where f.id = v_id and f.user_id = p_uid) then
      raise exception 'session_not_found' using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'applied');

  when 'habit.set_source' then
    v_source := p_op ->> 'source';
    v_from := (p_op ->> 'from')::date;
    select * into v_habit from public.habits h where h.id = (p_op ->> 'habit_id')::uuid and h.user_id = p_uid for update;
    if not found then raise exception 'habit_not_found' using errcode = 'P0001'; end if;
    if v_source is not null and v_habit.habit_type <> 'duration' then raise exception 'not_duration_habit' using errcode = 'P0001'; end if;
    if v_habit.activity_source is not distinct from v_source then return jsonb_build_object('outcome', 'applied'); end if;
    -- Linking applies from today (±1 day of timezone slack), never retroactively.
    if v_source is not null and (v_from is null or v_from < v_today - 1 or v_from > v_today + 1) then
      raise exception 'invalid_effective_date' using errcode = 'P0001';
    end if;
    update public.habits h
      set activity_source = v_source,
          activity_source_from = case when v_source is null then null else greatest(v_from, h.start_date) end,
          version = h.version + 1
      where h.id = v_habit.id;
    perform private.audit(p_uid, 'habit', v_habit.id, 'source', jsonb_build_object('source', v_source));
    return jsonb_build_object('outcome', 'applied');

  else
    raise exception 'unknown_op_type' using errcode = 'P0001';
  end case;
end;
$$;

revoke all on function private.apply_focus_op(uuid, text, jsonb) from public, anon;
revoke all on function private.focus_rederive(uuid, uuid, date) from public, anon;
revoke all on function private.iso(timestamptz) from public, anon;
grant execute on function private.apply_focus_op(uuid, text, jsonb) to authenticated;
grant execute on function private.focus_rederive(uuid, uuid, date) to authenticated;
grant execute on function private.iso(timestamptz) to authenticated;

-- ── apply_ops: same ledger; focus ops (and habit.set_source) routed to apply_focus_op ──
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
      if v_type like 'goal.%' then
        v_result := private.apply_goal_op(v_uid, v_type, v_op);
      elsif v_type like 'focus.%' or v_type = 'habit.set_source' then
        v_result := private.apply_focus_op(v_uid, v_type, v_op);
      else
        v_result := private.apply_op(v_uid, v_type, v_op);
      end if;
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

  return jsonb_build_object('results', v_results, 'server_today', public.user_today(v_uid), 'server_time', clock_timestamp());
end;
$$;

-- ── pull_changes: + habit activity source and focus sessions (with tombstones) ──
create or replace function public.pull_changes(p_since bigint default 0)
returns jsonb
language plpgsql
volatile
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
    'server_time', clock_timestamp(),
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
                  'activity_source', h.activity_source, 'activity_source_from', h.activity_source_from,
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
    -- A goal travels whole (links + milestones): child changes bump the goal's server_seq.
    'goals', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', g.id, 'title', g.title, 'why', g.why, 'parent_id', g.parent_goal_id,
                 'dimension', (select d.slug from public.dimensions d where d.id = g.dimension_id),
                 'metric_type', g.metric_type, 'source', g.source, 'source_habit_id', g.source_habit_id,
                 'aggregation', g.aggregation, 'unit', g.unit, 'baseline', g.baseline, 'target', g.target,
                 'direction', g.direction, 'threshold', g.threshold, 'start_date', g.start_date, 'due_date', g.due_date,
                 'horizon_override', g.horizon_override, 'priority', g.priority, 'aggregate_children', g.aggregate_children,
                 'state', g.state, 'closed_on', g.closed_on, 'archived_on', g.archived_on, 'version', g.version,
                 'created_at', g.created_at, 'updated_at', g.updated_at, 'server_seq', g.server_seq,
                 'habits', (select coalesce(jsonb_agg(jsonb_build_object('habit_id', l.habit_id, 'weight', l.weight) order by l.created_at), '[]'::jsonb)
                            from public.goal_habits l where l.goal_id = g.id and l.deleted_at is null),
                 'checkpoints', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'id', c.id, 'title', c.title, 'due_on', c.due_on, 'value', c.value, 'done_on', c.done_on)
                                    order by c.sort_order), '[]'::jsonb)
                                 from public.goal_checkpoints c where c.goal_id = g.id and c.deleted_at is null)
               ) order by g.created_at), '[]'::jsonb)
              from public.goals g
              where g.user_id = v_uid and g.server_seq > v_since),
    'measurements', (select coalesce(jsonb_agg(jsonb_build_object(
                        'goal_id', m.goal_id, 'observed_on', m.observed_on, 'value', m.value, 'note', m.note,
                        'deleted', m.deleted_at is not null, 'client_op_id', m.client_op_id,
                        'client_updated_at', m.client_updated_at, 'server_seq', m.server_seq)), '[]'::jsonb)
                     from public.goal_measurements m
                     where m.user_id = v_uid and m.server_seq > v_since and (not v_full or m.deleted_at is null)),
    'focus_sessions', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', f.id, 'habit_id', f.habit_id, 'project', f.project,
                          'planned_output', f.planned_output, 'actual_output', f.actual_output,
                          'planned_minutes', f.planned_minutes, 'segments', f.segments, 'state', f.state,
                          'active_seconds', f.active_seconds, 'local_date', f.local_date, 'rating', f.rating,
                          'version', f.version, 'created_at', f.created_at, 'updated_at', f.updated_at,
                          'deleted', f.deleted_at is not null, 'server_seq', f.server_seq) order by f.started_at), '[]'::jsonb)
                       from public.focus_sessions f
                       where f.user_id = v_uid and f.server_seq > v_since and (not v_full or f.deleted_at is null)),
    'cursor', greatest(v_since,
      coalesce((select max(h.server_seq) from public.habits h where h.user_id = v_uid), 0),
      coalesce((select max(e.server_seq) from public.habit_entries e where e.user_id = v_uid), 0),
      coalesce((select max(r.server_seq) from public.routine_calendar r where r.user_id = v_uid), 0),
      coalesce((select max(g.server_seq) from public.goals g where g.user_id = v_uid), 0),
      coalesce((select max(m.server_seq) from public.goal_measurements m where m.user_id = v_uid), 0),
      coalesce((select max(f.server_seq) from public.focus_sessions f where f.user_id = v_uid), 0),
      coalesce((select p.server_seq from public.profiles p where p.id = v_uid), 0))
  );
end;
$$;
