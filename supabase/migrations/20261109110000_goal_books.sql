-- C3 · Goals linked to books of the Library (Plan Maestro 5.4).
-- Additive only: one column with a default, one new operation and one new key in the pull payload.
-- A plain list of ids rather than a foreign key: a book deleted from the Library simply stops being
-- listed and never blocks or cascades into the goal. goal.update does not touch the column.

alter table public.goals
  add column book_ids jsonb not null default '[]'::jsonb
    constraint goals_book_ids_array check (jsonb_typeof(book_ids) = 'array');

create or replace function private.apply_goal_op(p_uid uuid, p_type text, p_op jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_today date := public.user_today(p_uid);
  v_id uuid := coalesce((p_op ->> 'goal_id')::uuid, (p_op #>> '{goal,id}')::uuid);
  v_goal public.goals;
  v_new public.goals;
  v_date date;
  v_ts timestamptz;
  v_base bigint;
  v_m public.goal_measurements;
  v_value jsonb;
begin
  case p_type

  when 'goal.create' then
    v_new := private.goal_row(p_uid, p_op -> 'goal');
    insert into public.goals (id, user_id, parent_goal_id, dimension_id, title, why, metric_type, source, source_habit_id,
      aggregation, unit, baseline, target, direction, threshold, start_date, due_date, horizon_override, priority, aggregate_children)
    values (v_id, p_uid, v_new.parent_goal_id, v_new.dimension_id, v_new.title, v_new.why, v_new.metric_type, v_new.source,
      v_new.source_habit_id, v_new.aggregation, v_new.unit, v_new.baseline, v_new.target, v_new.direction, v_new.threshold,
      v_new.start_date, v_new.due_date, v_new.horizon_override, v_new.priority, v_new.aggregate_children)
    on conflict (id) do nothing;
    if not found then
      if exists (select 1 from public.goals g where g.id = v_id and g.user_id = p_uid) then
        return jsonb_build_object('outcome', 'applied', 'existing', true);
      end if;
      raise exception 'id_conflict' using errcode = 'P0001';
    end if;
    perform private.sync_goal_children(p_uid, v_id, p_op -> 'habits', p_op -> 'checkpoints', true);
    perform private.audit(p_uid, 'goal', v_id, 'create', jsonb_build_object('title', v_new.title));
    return jsonb_build_object('outcome', 'applied');

  when 'goal.update' then
    select * into v_goal from public.goals g where g.id = v_id and g.user_id = p_uid for update;
    if not found then raise exception 'goal_not_found' using errcode = 'P0001'; end if;
    -- Edited on another device since this client last saw it: report, do not overwrite.
    if v_goal.version <> (p_op ->> 'base_version')::int then
      return jsonb_build_object('outcome', 'conflict', 'current_version', v_goal.version);
    end if;
    v_new := private.goal_row(p_uid, (p_op -> 'goal') || jsonb_build_object(
      'metric_type', v_goal.metric_type, 'source', v_goal.source, 'source_habit_id', v_goal.source_habit_id));
    update public.goals g set
      parent_goal_id = v_new.parent_goal_id, dimension_id = v_new.dimension_id, title = v_new.title, why = v_new.why,
      aggregation = v_new.aggregation, unit = v_new.unit, baseline = v_new.baseline, target = v_new.target,
      direction = v_new.direction, threshold = v_new.threshold, start_date = v_new.start_date, due_date = v_new.due_date,
      horizon_override = v_new.horizon_override, priority = v_new.priority, aggregate_children = v_new.aggregate_children,
      version = g.version + 1
    where g.id = v_id;
    perform private.sync_goal_children(p_uid, v_id, p_op -> 'habits', p_op -> 'checkpoints', false);
    perform private.audit(p_uid, 'goal', v_id, 'update', jsonb_build_object('title', v_new.title));
    return jsonb_build_object('outcome', 'applied');

  when 'goal.set_state' then
    v_date := (p_op ->> 'on')::date;
    if p_op ->> 'state' <> 'active' and (v_date is null or v_date < v_today - 1 or v_date > v_today + 1) then
      raise exception 'invalid_state_date' using errcode = 'P0001';
    end if;
    update public.goals g set
      state = p_op ->> 'state',
      closed_on = case when p_op ->> 'state' = 'active' then null else v_date end,
      version = g.version + 1
    where g.id = v_id and g.user_id = p_uid and g.state is distinct from p_op ->> 'state';
    if not found and not exists (select 1 from public.goals g where g.id = v_id and g.user_id = p_uid) then
      raise exception 'goal_not_found' using errcode = 'P0001';
    end if;
    perform private.audit(p_uid, 'goal', v_id, 'state', jsonb_build_object('state', p_op ->> 'state'));
    return jsonb_build_object('outcome', 'applied');

  when 'goal.archive' then
    v_date := (p_op ->> 'archived_on')::date;
    if v_date is null or v_date < v_today - 1 or v_date > v_today + 1 then
      raise exception 'invalid_archive_date' using errcode = 'P0001';
    end if;
    update public.goals g set archived_on = v_date, version = g.version + 1
      where g.id = v_id and g.user_id = p_uid and g.archived_on is null;
    if not found and not exists (select 1 from public.goals g where g.id = v_id and g.user_id = p_uid) then
      raise exception 'goal_not_found' using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'applied');

  when 'goal.set_review' then
    -- Desired state: a date puts the goal in review, null takes it out. The first date is kept.
    v_date := (p_op ->> 'review_since')::date;
    if v_date is not null and (v_date < v_today - 1 or v_date > v_today + 1) then
      raise exception 'invalid_review_date' using errcode = 'P0001';
    end if;
    update public.goals g set review_since = v_date, version = g.version + 1
      where g.id = v_id and g.user_id = p_uid and (g.review_since is null) <> (v_date is null);
    if not found and not exists (select 1 from public.goals g where g.id = v_id and g.user_id = p_uid) then
      raise exception 'goal_not_found' using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'applied');

  when 'goal.log_add' then
    -- Appended, not an edit of the definition: no version bump, so it never conflicts with goal.update.
    v_value := p_op -> 'entry';
    v_date := (v_value ->> 'on')::date;
    if coalesce(v_value ->> 'id', '') !~ '^[0-9a-fA-F-]{36}$'
       or coalesce(v_value ->> 'kind', '') not in ('obstacle', 'adjustment')
       or char_length(btrim(coalesce(v_value ->> 'text', ''))) not between 1 and 500
       or not private.lib_no_ctrl(v_value ->> 'text')
       or v_date is null or v_date < v_today - 1 or v_date > v_today + 1 then
      raise exception 'invalid_goal_log' using errcode = 'P0001';
    end if;
    select * into v_goal from public.goals g where g.id = v_id and g.user_id = p_uid for update;
    if not found then raise exception 'goal_not_found' using errcode = 'P0001'; end if;
    if exists (select 1 from jsonb_array_elements(v_goal.process_log) e where e ->> 'id' = v_value ->> 'id') then
      return jsonb_build_object('outcome', 'applied', 'existing', true);
    end if;
    if jsonb_array_length(v_goal.process_log) >= 200 then
      raise exception 'goal_log_full' using errcode = 'P0001';
    end if;
    update public.goals g set process_log = g.process_log || jsonb_build_array(jsonb_build_object(
      'id', v_value ->> 'id', 'kind', v_value ->> 'kind', 'text', btrim(v_value ->> 'text'), 'on', v_date))
      where g.id = v_id;
    return jsonb_build_object('outcome', 'applied');

  when 'goal.log_remove' then
    select * into v_goal from public.goals g where g.id = v_id and g.user_id = p_uid for update;
    if not found then raise exception 'goal_not_found' using errcode = 'P0001'; end if;
    update public.goals g set process_log = coalesce((
        select jsonb_agg(e order by n) from jsonb_array_elements(g.process_log) with ordinality as t(e, n)
        where e ->> 'id' <> p_op ->> 'entry_id'), '[]'::jsonb)
      where g.id = v_id and exists (select 1 from jsonb_array_elements(g.process_log) e where e ->> 'id' = p_op ->> 'entry_id');
    return jsonb_build_object('outcome', 'applied');

  when 'goal.book_set' then
    -- Desired state, not an edit of the definition: no version bump, so it never conflicts with goal.update.
    select * into v_goal from public.goals g where g.id = v_id and g.user_id = p_uid for update;
    if not found then raise exception 'goal_not_found' using errcode = 'P0001'; end if;
    if (p_op ->> 'linked')::boolean then
      if not exists (select 1 from public.library_items i where i.id::text = p_op ->> 'item_id' and i.user_id = p_uid and i.kind = 'book' and i.deleted_at is null) then
        raise exception 'book_not_found' using errcode = 'P0001';
      end if;
      if v_goal.book_ids ? (p_op ->> 'item_id') then
        return jsonb_build_object('outcome', 'applied', 'existing', true);
      end if;
      if jsonb_array_length(v_goal.book_ids) >= 100 then
        raise exception 'goal_books_full' using errcode = 'P0001';
      end if;
      update public.goals g set book_ids = g.book_ids || to_jsonb(p_op ->> 'item_id') where g.id = v_id;
    elsif v_goal.book_ids ? (p_op ->> 'item_id') then
      update public.goals g set book_ids = g.book_ids - (p_op ->> 'item_id') where g.id = v_id;
    end if;
    return jsonb_build_object('outcome', 'applied');

  when 'goal.restore' then
    update public.goals g set archived_on = null, version = g.version + 1
      where g.id = v_id and g.user_id = p_uid and g.archived_on is not null;
    if not found and not exists (select 1 from public.goals g where g.id = v_id and g.user_id = p_uid) then
      raise exception 'goal_not_found' using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'applied');

  when 'goal.checkpoint.set' then
    v_date := (p_op ->> 'done_on')::date;
    update public.goal_checkpoints c set done_on = v_date
      where c.id = (p_op ->> 'checkpoint_id')::uuid and c.goal_id = v_id and c.user_id = p_uid and c.deleted_at is null
        and c.value is null and c.done_on is distinct from v_date;
    if not found and not exists (
      select 1 from public.goal_checkpoints c
      where c.id = (p_op ->> 'checkpoint_id')::uuid and c.goal_id = v_id and c.user_id = p_uid and c.deleted_at is null and c.value is null
    ) then
      raise exception 'checkpoint_not_found' using errcode = 'P0001';
    end if;
    -- Milestones travel inside their goal in pull_changes: bump the goal so other devices refetch it.
    update public.goals g set updated_at = now() where g.id = v_id and g.user_id = p_uid;
    return jsonb_build_object('outcome', 'applied');

  when 'goal.measure' then
    v_date := (p_op ->> 'observed_on')::date;
    v_ts := (p_op ->> 'client_updated_at')::timestamptz;
    v_value := p_op -> 'value';
    if v_ts is null then raise exception 'missing_client_time' using errcode = 'P0001'; end if;
    v_ts := least(v_ts, clock_timestamp() + interval '1 minute');
    v_base := nullif(p_op ->> 'base_seq', '')::bigint;
    select * into v_m from public.goal_measurements m
      where m.goal_id = v_id and m.user_id = p_uid and m.observed_on = v_date for update;
    if found then
      -- Same rules as habit entries: a sequential edit wins; concurrent ones compare hybrid time.
      if v_base is not null and v_m.server_seq <= v_base then
        v_ts := greatest(v_ts, v_m.client_updated_at + interval '1 millisecond');
      elsif v_m.client_updated_at > v_ts then
        return jsonb_build_object('outcome', 'superseded');
      end if;
    end if;
    if v_value is null or jsonb_typeof(v_value) = 'null' then
      insert into public.goal_measurements (goal_id, user_id, observed_on, client_op_id, client_updated_at, deleted_at)
      values (v_id, p_uid, v_date, p_op ->> 'op_id', v_ts, now())
      on conflict (goal_id, observed_on) do update
        set deleted_at = now(), value = null, note = null,
            client_op_id = excluded.client_op_id, client_updated_at = excluded.client_updated_at;
    elsif jsonb_typeof(v_value) = 'number' then
      insert into public.goal_measurements (goal_id, user_id, observed_on, value, note, client_op_id, client_updated_at)
      values (v_id, p_uid, v_date, (v_value #>> '{}')::numeric, nullif(btrim(coalesce(p_op ->> 'note', '')), ''), p_op ->> 'op_id', v_ts)
      on conflict (goal_id, observed_on) do update
        set value = excluded.value, note = excluded.note, deleted_at = null,
            client_op_id = excluded.client_op_id, client_updated_at = excluded.client_updated_at;
    else
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
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
