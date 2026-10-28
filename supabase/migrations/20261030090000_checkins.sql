-- M3.3 · Mind & Energy check-ins (docs/m3.3-mind-energy-plan.md §3). Additive only:
-- one new table, new functions, a guard on profiles.settings_json.checkin, and new branches in
-- apply_ops / pull_changes. The published client ignores the new pull keys.

-- ── Table ────────────────────────────────────────────────────────────────
create table public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_date date not null,
  phase text not null check (phase in ('am', 'pm')),
  sleep_hours numeric(4, 2) check (sleep_hours between 0 and 16 and sleep_hours * 4 = trunc(sleep_hours * 4)),
  energy smallint check (energy between 1 and 5),
  mood smallint check (mood between 1 and 5),
  stress smallint check (stress between 1 and 5),
  note text check (char_length(note) between 1 and 1000),
  -- Per-field instant of the last write (decision 3: per-field last-writer-wins).
  field_stamps jsonb not null default '{}'::jsonb check (jsonb_typeof(field_stamps) = 'object'),
  -- server_seq of the last reflection change: the conflict base for concurrent reflections.
  note_seq bigint,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null default nextval('public.change_seq'),
  -- Spec: one check-in per day and phase.
  unique (user_id, local_date, phase)
);
create index daily_checkins_user_seq on public.daily_checkins (user_id, server_seq);

-- Sequence, timestamps, tombstone and note_seq in one trigger (note_seq needs the new server_seq).
create or replace function private.guard_checkin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.id <> old.id or new.local_date <> old.local_date or new.phase <> old.phase) then
    raise exception 'immutable_identity' using errcode = 'P0001';
  end if;
  new.server_seq := nextval('public.change_seq');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.version := old.version + 1;
    if new.note is distinct from old.note then new.note_seq := new.server_seq; end if;
  elsif new.note is not null then
    new.note_seq := new.server_seq;
  end if;
  -- A check-in left without any value is a tombstone (other devices remove it on pull).
  if new.sleep_hours is null and new.energy is null and new.mood is null and new.stress is null and new.note is null then
    new.deleted_at := coalesce(new.deleted_at, now());
  else
    new.deleted_at := null;
  end if;
  return new;
end;
$$;
create trigger daily_checkins_guard before insert or update on public.daily_checkins
  for each row execute function private.guard_checkin();

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.daily_checkins enable row level security;

create policy "checkins: read own" on public.daily_checkins for select to authenticated
  using (user_id = (select auth.uid()));
create policy "checkins: insert own" on public.daily_checkins for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "checkins: update own" on public.daily_checkins for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.daily_checkins from anon;
revoke delete, truncate on public.daily_checkins from authenticated;

alter publication supabase_realtime add table public.daily_checkins;

-- ── Indicators per phase (profiles.settings_json.checkin, decision 4) ──────
-- Mirrors validateConfig() in src/features/mind/domain/ops.ts.
create or replace function private.valid_checkin_config(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_phase text;
  v_arr jsonb;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' then return false; end if;
  foreach v_phase in array array['am', 'pm'] loop
    v_arr := p -> v_phase;
    if jsonb_typeof(v_arr) is distinct from 'array' or jsonb_array_length(v_arr) > 5 then return false; end if;
    if exists (select 1 from jsonb_array_elements(v_arr) e
               where jsonb_typeof(e) <> 'string' or (e #>> '{}') not in ('sleep', 'energy', 'mood', 'stress', 'note')) then
      return false;
    end if;
    if not exists (select 1 from jsonb_array_elements_text(v_arr) e where e in ('sleep', 'energy', 'mood', 'stress')) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- profiles is updatable by its owner: the setting is validated however it is written.
create or replace function private.guard_profile_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.settings_json -> 'checkin') is distinct from (old.settings_json -> 'checkin')
     and not private.valid_checkin_config(new.settings_json -> 'checkin') then
    raise exception 'invalid_config' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger profiles_settings_guard before update on public.profiles
  for each row execute function private.guard_profile_settings();

-- ── Operations ───────────────────────────────────────────────────────────
-- Mirrors setCheckin() in src/features/mind/domain/ops.ts and FakeServer.applyCheckin.
create or replace function private.apply_checkin_op(p_uid uuid, p_type text, p_op jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_date date;
  v_phase text;
  v_fields jsonb;
  v_at timestamptz;
  v_row public.daily_checkins;
  v_found boolean;
  v_note text;
  v_key text;
  v_stamp timestamptz;
  v_stamps jsonb;
  v_changed text[] := '{}';
  v_sleep numeric;
  v_energy smallint;
  v_mood smallint;
  v_stress smallint;
  v_cfg jsonb;
begin
  case p_type

  when 'checkin.set' then
    v_date := (p_op ->> 'local_date')::date;
    v_phase := p_op ->> 'phase';
    v_fields := p_op -> 'fields';
    if v_date is null or v_phase is null or v_phase not in ('am', 'pm') then
      raise exception 'invalid_date' using errcode = 'P0001';
    end if;
    -- One day of slack: the evening rollover (04:00) and clocks around midnight.
    if v_date > public.user_today(p_uid) + 1 then
      raise exception 'future_date' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_fields) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_fields) k where k not in ('sleep_hours', 'energy', 'mood', 'stress', 'note')) then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
    -- Device times never go beyond "now" (+1 min of slack).
    v_at := least(coalesce((p_op ->> 'at')::timestamptz, clock_timestamp()), clock_timestamp() + interval '1 minute');

    if v_fields ? 'note' then
      -- Same cleaning as cleanNote(): CRLF → LF, trimmed, empty → null.
      v_note := nullif(regexp_replace(replace(replace(coalesce(v_fields ->> 'note', ''), E'\r\n', E'\n'), E'\r', E'\n'), '^\s+|\s+$', '', 'g'), '');
      if char_length(v_note) > 1000 then raise exception 'invalid_value' using errcode = 'P0001'; end if;
    end if;

    select * into v_row from public.daily_checkins c
      where c.user_id = p_uid and c.local_date = v_date and c.phase = v_phase for update;
    v_found := found;

    -- A reflection written meanwhile on another device is never overwritten silently.
    if v_found and v_fields ? 'note' and v_row.note is not null and v_row.note is distinct from v_note
       and v_row.note_seq is distinct from (p_op ->> 'base_note_seq')::bigint then
      return jsonb_build_object('outcome', 'conflict', 'code', 'note_conflict');
    end if;

    if not v_found then
      v_row.sleep_hours := null; v_row.energy := null; v_row.mood := null; v_row.stress := null; v_row.note := null;
      v_row.field_stamps := '{}'::jsonb;
    end if;
    v_stamps := v_row.field_stamps;

    foreach v_key in array array['sleep_hours', 'energy', 'mood', 'stress', 'note'] loop
      continue when not v_fields ? v_key;
      v_stamp := (v_stamps ->> v_key)::timestamptz;
      continue when v_stamp is not null and v_stamp > v_at;
      case v_key
        when 'sleep_hours' then
          v_sleep := (v_fields ->> 'sleep_hours')::numeric;
          if v_row.sleep_hours is distinct from v_sleep then v_changed := v_changed || v_key; end if;
          v_row.sleep_hours := v_sleep;
        when 'energy' then
          v_energy := (v_fields ->> 'energy')::smallint;
          if v_row.energy is distinct from v_energy then v_changed := v_changed || v_key; end if;
          v_row.energy := v_energy;
        when 'mood' then
          v_mood := (v_fields ->> 'mood')::smallint;
          if v_row.mood is distinct from v_mood then v_changed := v_changed || v_key; end if;
          v_row.mood := v_mood;
        when 'stress' then
          v_stress := (v_fields ->> 'stress')::smallint;
          if v_row.stress is distinct from v_stress then v_changed := v_changed || v_key; end if;
          v_row.stress := v_stress;
        else
          if v_row.note is distinct from v_note then v_changed := v_changed || v_key; end if;
          v_row.note := v_note;
      end case;
      v_stamps := jsonb_set(v_stamps, array[v_key], to_jsonb(private.iso(v_at)));
    end loop;

    if cardinality(v_changed) = 0 then
      return jsonb_build_object('outcome', 'applied');
    end if;

    if v_found then
      update public.daily_checkins c set
        sleep_hours = v_row.sleep_hours, energy = v_row.energy, mood = v_row.mood, stress = v_row.stress,
        note = v_row.note, field_stamps = v_stamps
      where c.id = v_row.id;
    else
      insert into public.daily_checkins (user_id, local_date, phase, sleep_hours, energy, mood, stress, note, field_stamps)
      values (p_uid, v_date, v_phase, v_row.sleep_hours, v_row.energy, v_row.mood, v_row.stress, v_row.note, v_stamps)
      returning * into v_row;
    end if;
    -- Field names only: never values or reflection text in the audit log.
    perform private.audit(p_uid, 'daily_checkin', v_row.id, 'set', jsonb_build_object('fields', to_jsonb(v_changed)));
    return jsonb_build_object('outcome', 'applied');

  when 'profile.checkin_fields' then
    -- Desired state of both phases, stored in canonical order.
    select jsonb_build_object(
      'am', coalesce((select jsonb_agg(f order by o) from unnest(array['sleep', 'energy', 'mood', 'stress', 'note']) with ordinality u(f, o)
                      where jsonb_typeof(p_op -> 'am') = 'array' and (p_op -> 'am') ? f), '[]'::jsonb),
      'pm', coalesce((select jsonb_agg(f order by o) from unnest(array['sleep', 'energy', 'mood', 'stress', 'note']) with ordinality u(f, o)
                      where jsonb_typeof(p_op -> 'pm') = 'array' and (p_op -> 'pm') ? f), '[]'::jsonb))
      into v_cfg;
    if not private.valid_checkin_config(jsonb_build_object('am', p_op -> 'am', 'pm', p_op -> 'pm'))
       or not private.valid_checkin_config(v_cfg) then
      raise exception 'invalid_config' using errcode = 'P0001';
    end if;
    update public.profiles p set settings_json = jsonb_set(coalesce(p.settings_json, '{}'::jsonb), '{checkin}', v_cfg)
      where p.id = p_uid and (p.settings_json -> 'checkin') is distinct from v_cfg;
    return jsonb_build_object('outcome', 'applied');

  else
    raise exception 'unknown_op_type' using errcode = 'P0001';
  end case;
end;
$$;

revoke all on function private.apply_checkin_op(uuid, text, jsonb) from public, anon;
revoke all on function private.valid_checkin_config(jsonb) from public, anon;
grant execute on function private.apply_checkin_op(uuid, text, jsonb) to authenticated;
grant execute on function private.valid_checkin_config(jsonb) to authenticated;

-- ── apply_ops: same ledger; check-in ops routed to apply_checkin_op ──────
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
      elsif v_type like 'checkin.%' or v_type = 'profile.checkin_fields' then
        v_result := private.apply_checkin_op(v_uid, v_type, v_op);
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

-- ── pull_changes: + daily_checkins (with tombstones) and the profile's check-in indicators ──
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
    'profile', (select jsonb_build_object('timezone', p.timezone, 'locale', p.locale, 'server_seq', p.server_seq,
                                          'checkin_fields', p.settings_json -> 'checkin')
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
    'daily_checkins', (select coalesce(jsonb_agg(jsonb_build_object(
                          'local_date', c.local_date, 'phase', c.phase, 'sleep_hours', c.sleep_hours,
                          'energy', c.energy, 'mood', c.mood, 'stress', c.stress, 'note', c.note,
                          'field_stamps', c.field_stamps, 'note_seq', c.note_seq, 'updated_at', c.updated_at,
                          'deleted', c.deleted_at is not null, 'server_seq', c.server_seq) order by c.local_date, c.phase), '[]'::jsonb)
                       from public.daily_checkins c
                       where c.user_id = v_uid and c.server_seq > v_since and (not v_full or c.deleted_at is null)),
    'cursor', greatest(v_since,
      coalesce((select max(h.server_seq) from public.habits h where h.user_id = v_uid), 0),
      coalesce((select max(e.server_seq) from public.habit_entries e where e.user_id = v_uid), 0),
      coalesce((select max(r.server_seq) from public.routine_calendar r where r.user_id = v_uid), 0),
      coalesce((select max(g.server_seq) from public.goals g where g.user_id = v_uid), 0),
      coalesce((select max(m.server_seq) from public.goal_measurements m where m.user_id = v_uid), 0),
      coalesce((select max(f.server_seq) from public.focus_sessions f where f.user_id = v_uid), 0),
      coalesce((select max(c.server_seq) from public.daily_checkins c where c.user_id = v_uid), 0),
      coalesce((select p.server_seq from public.profiles p where p.id = v_uid), 0))
  );
end;
$$;
