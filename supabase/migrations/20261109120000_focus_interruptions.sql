-- C4 · Deep Work: note how many interruptions a session had (Plan Maestro 5.5).
-- Additive only: one nullable column and one new key in the pull payload. NULL means not noted,
-- which is what every existing session keeps: an old session never turns into «0 interruptions».
-- focus.finish and focus.edit only write the column when the operation carries the key, so a
-- published client that does not know it cannot erase what a newer one recorded.

alter table public.focus_sessions
  add column interruptions smallint check (interruptions between 0 and 99);

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
      interruptions = case when p_op ? 'interruptions' then (p_op ->> 'interruptions')::smallint else f.interruptions end,
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
      interruptions = case when p_op ? 'interruptions' then (p_op ->> 'interruptions')::smallint else f.interruptions end,
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
                 'state', g.state, 'closed_on', g.closed_on, 'archived_on', g.archived_on, 'review_since', g.review_since, 'process_log', g.process_log, 'book_ids', g.book_ids, 'version', g.version,
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
                          'active_seconds', f.active_seconds, 'local_date', f.local_date, 'rating', f.rating, 'interruptions', f.interruptions,
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
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object(
                   'kind', rv.kind, 'period_start', rv.period_start, 'period_end', rv.period_end, 'status', rv.status,
                   'content', rv.content, 'decisions', rv.decisions, 'evaluations', rv.evaluations,
                   'field_seqs', rv.field_seqs, 'snapshot', rv.snapshot, 'metrics_version', rv.metrics_version,
                   'snapshot_version', rv.snapshot_version, 'timezone', rv.timezone, 'closed_at', rv.closed_at,
                   'version', rv.version, 'updated_at', rv.updated_at,
                   'deleted', rv.deleted_at is not null, 'server_seq', rv.server_seq) order by rv.period_start, rv.kind), '[]'::jsonb)
                from public.reviews rv
                where rv.user_id = v_uid and rv.server_seq > v_since and (not v_full or rv.deleted_at is null)),
    'library', jsonb_build_object('head', private.lib_head(v_uid)),
    'cursor', greatest(v_since,
      coalesce((select max(h.server_seq) from public.habits h where h.user_id = v_uid), 0),
      coalesce((select max(e.server_seq) from public.habit_entries e where e.user_id = v_uid), 0),
      coalesce((select max(r.server_seq) from public.routine_calendar r where r.user_id = v_uid), 0),
      coalesce((select max(g.server_seq) from public.goals g where g.user_id = v_uid), 0),
      coalesce((select max(m.server_seq) from public.goal_measurements m where m.user_id = v_uid), 0),
      coalesce((select max(f.server_seq) from public.focus_sessions f where f.user_id = v_uid), 0),
      coalesce((select max(c.server_seq) from public.daily_checkins c where c.user_id = v_uid), 0),
      coalesce((select max(rv.server_seq) from public.reviews rv where rv.user_id = v_uid), 0),
      coalesce((select p.server_seq from public.profiles p where p.id = v_uid), 0))
  );
end;
$$;
