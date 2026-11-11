-- E6 · Notification settings (PRD §5.1). Additive: one new key in the profile's settings_json, one
-- new operation and one more key in the profile of pull_changes. No new table: the settings are one
-- desired state per user, like the check-in fields, and live next to them under their own key, so
-- neither write touches the other. Published clients ignore the key and never send the operation.

-- Mirrors normalizeMotivation (src/features/notifications/domain/settings.ts), but strict: the app
-- always sends a complete, valid object.
create or replace function private.valid_motivation(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) k
                    where k not in ('enabled', 'tone', 'profanity', 'dailyCap', 'quietStart', 'quietEnd', 'minGapMinutes', 'daysOff', 'rules', 'times'))
    and jsonb_typeof(p -> 'enabled') = 'boolean'
    and p ->> 'tone' in ('calm', 'balanced', 'hardcore')
    and jsonb_typeof(p -> 'profanity') = 'boolean'
    -- Strong language only with the Hardcore tone.
    and (p ->> 'tone' = 'hardcore' or p -> 'profanity' = 'false'::jsonb)
    and jsonb_typeof(p -> 'dailyCap') = 'number' and (p ->> 'dailyCap') ~ '^([1-9]|10)$'
    and (p ->> 'quietStart') ~ '^([01]\d|2[0-3]):[0-5]\d$'
    and (p ->> 'quietEnd') ~ '^([01]\d|2[0-3]):[0-5]\d$'
    and jsonb_typeof(p -> 'minGapMinutes') = 'number' and (p ->> 'minGapMinutes') ~ '^\d{1,3}$' and (p ->> 'minGapMinutes')::integer <= 720
    and jsonb_typeof(p -> 'daysOff') = 'array' and jsonb_array_length(p -> 'daysOff') <= 7
    and not exists (select 1 from jsonb_array_elements(p -> 'daysOff') d where jsonb_typeof(d) <> 'number' or (d #>> '{}') !~ '^[1-7]$')
    and jsonb_typeof(p -> 'rules') = 'object'
    and (select count(*) from jsonb_object_keys(p -> 'rules')) = 7
    and (select count(*) from jsonb_each(p -> 'rules') r
         where r.key in ('morning', 'due', 'late', 'allDone', 'review', 'recall', 'focus') and jsonb_typeof(r.value) = 'boolean') = 7
    and jsonb_typeof(p -> 'times') = 'object'
    and (select count(*) from jsonb_object_keys(p -> 'times')) = 6
    and (select count(*) from jsonb_each(p -> 'times') t
         where t.key in ('morning', 'due', 'late', 'review', 'recall', 'focus') and jsonb_typeof(t.value) = 'string'
           and (t.value #>> '{}') ~ '^([01]\d|2[0-3]):[0-5]\d$') = 6,
    false)
$$;

create or replace function private.apply_motivation_op(p_uid uuid, p_op jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_settings jsonb := p_op -> 'settings';
begin
  if p_uid is null or p_uid is distinct from auth.uid() then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.valid_motivation(v_settings) then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  update public.profiles p set settings_json = jsonb_set(coalesce(p.settings_json, '{}'::jsonb), '{motivation}', v_settings)
    where p.id = p_uid and (p.settings_json -> 'motivation') is distinct from v_settings;
  if found then perform private.audit(p_uid, 'profile', p_uid, 'motivation', '{}'::jsonb); end if;
  return jsonb_build_object('outcome', 'applied');
end;
$$;

revoke all on function private.valid_motivation(jsonb) from public, anon;
revoke all on function private.apply_motivation_op(uuid, jsonb) from public, anon;
grant execute on function private.valid_motivation(jsonb) to authenticated;
grant execute on function private.apply_motivation_op(uuid, jsonb) to authenticated;

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
        'op_id', v_id, 'status', 'duplicate', 'outcome', v_prev.outcome, 'code', v_prev.result ->> 'code')
        || case when v_prev.result ? 'fields' then jsonb_build_object('fields', v_prev.result -> 'fields') else '{}'::jsonb end
        || case when v_prev.result ? 'seq' then jsonb_build_object('seq', v_prev.result -> 'seq') else '{}'::jsonb end);
      continue;
    end if;

    begin
      if v_type like 'goal.%' then
        v_result := private.apply_goal_op(v_uid, v_type, v_op);
      elsif v_type like 'focus.%' or v_type = 'habit.set_source' then
        v_result := private.apply_focus_op(v_uid, v_type, v_op);
      elsif v_type like 'checkin.%' or v_type = 'profile.checkin_fields' then
        v_result := private.apply_checkin_op(v_uid, v_type, v_op);
      elsif v_type like 'review.%' then
        v_result := private.apply_review_op(v_uid, v_type, v_op);
      elsif v_type like 'library.%' then
        v_result := private.apply_library_op(v_uid, v_type, v_op);
      elsif v_type like 'recall.%' then
        v_result := private.apply_recall_op(v_uid, v_type, v_op);
      elsif v_type like 'discovery.%' then
        v_result := private.apply_discovery_op(v_uid, v_type, v_op);
      elsif v_type like 'experiment.%' then
        v_result := private.apply_experiment_op(v_uid, v_type, v_op);
      elsif v_type = 'profile.motivation' then
        v_result := private.apply_motivation_op(v_uid, v_op);
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

    -- `fields` (M3.4): the sections of a review edit, or the fields of a library edit, that conflicted.
    -- `seq` (M4b): the library row's server_seq after the write, the base of the next edit.
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'op_id', v_id, 'status', v_outcome, 'code', v_result ->> 'code')
      || case when v_result ? 'fields' then jsonb_build_object('fields', v_result -> 'fields') else '{}'::jsonb end
      || case when v_result ? 'seq' then jsonb_build_object('seq', v_result -> 'seq') else '{}'::jsonb end);
  end loop;

  return jsonb_build_object('results', v_results, 'server_today', public.user_today(v_uid), 'server_time', clock_timestamp());
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
                                          'checkin_fields', p.settings_json -> 'checkin',
                                          'motivation', p.settings_json -> 'motivation')
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
                where rv.user_id = v_uid and rv.kind <> 'day' and rv.server_seq > v_since and (not v_full or rv.deleted_at is null)),
    -- Daily reviews travel apart: a client published before them never receives a kind it does not know.
    'daily_reviews', (select coalesce(jsonb_agg(jsonb_build_object(
                   'kind', rv.kind, 'period_start', rv.period_start, 'period_end', rv.period_end, 'status', rv.status,
                   'content', rv.content, 'decisions', rv.decisions, 'evaluations', rv.evaluations,
                   'field_seqs', rv.field_seqs, 'snapshot', rv.snapshot, 'metrics_version', rv.metrics_version,
                   'snapshot_version', rv.snapshot_version, 'timezone', rv.timezone, 'closed_at', rv.closed_at,
                   'version', rv.version, 'updated_at', rv.updated_at,
                   'deleted', rv.deleted_at is not null, 'server_seq', rv.server_seq) order by rv.period_start, rv.kind), '[]'::jsonb)
                from public.reviews rv
                where rv.user_id = v_uid and rv.kind = 'day' and rv.server_seq > v_since and (not v_full or rv.deleted_at is null)),
    'experiments', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', x.id, 'title', x.title, 'metric_kind', x.metric_kind, 'metric_ref', x.metric_ref, 'start_on', x.start_on,
                      'days', x.days, 'status', x.status, 'ended_on', x.ended_on, 'note', x.note, 'created_at', x.created_at,
                      'deleted', x.deleted_at is not null, 'server_seq', x.server_seq) order by x.created_at), '[]'::jsonb)
                   from public.experiments x
                   where x.user_id = v_uid and x.server_seq > v_since and (not v_full or x.deleted_at is null)),
    'discovery_topics', (select coalesce(jsonb_agg(jsonb_build_object(
                           'id', d.id, 'title', d.title, 'category', d.category, 'body', d.body, 'source_title', d.source_title,
                           'source_url', d.source_url, 'created_at', d.created_at, 'updated_at', d.updated_at,
                           'deleted', d.deleted_at is not null, 'server_seq', d.server_seq) order by d.created_at), '[]'::jsonb)
                        from public.discovery_topics d
                        where d.user_id = v_uid and d.server_seq > v_since and (not v_full or d.deleted_at is null)),
    'topic_feedback', (select coalesce(jsonb_agg(jsonb_build_object(
                         'topic_key', f.topic_key, 'rating', f.rating, 'saved', f.saved, 'dismissed', f.dismissed,
                         'decided_on', f.decided_on, 'updated_at', f.updated_at, 'server_seq', f.server_seq) order by f.topic_key), '[]'::jsonb)
                      from public.topic_feedback f
                      where f.user_id = v_uid and f.server_seq > v_since),
    -- Active Recall. A full pull brings only 90 days of attempts: enough for every screen, and it does not grow forever.
    'recall_cards', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', c.id, 'source_type', c.source_type, 'source_id', c.source_id, 'question', c.question, 'answer', c.answer,
                       'state', c.state, 'reps', c.reps, 'lapses', c.lapses, 'ease_factor', c.ease_factor, 'interval_days', c.interval_days,
                       'due_on', c.due_on, 'algorithm_version', c.algorithm_version, 'suspended_on', c.suspended_on,
                       'first_answered_on', c.first_answered_on, 'last_answered_at', c.last_answered_at, 'version', c.version,
                       'created_at', c.created_at, 'updated_at', c.updated_at,
                       'deleted', c.deleted_at is not null, 'server_seq', c.server_seq) order by c.created_at), '[]'::jsonb)
                    from public.recall_cards c
                    where c.user_id = v_uid and c.server_seq > v_since and (not v_full or c.deleted_at is null)),
    'recall_attempts', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', t.id, 'card_id', t.card_id, 'grade', t.grade, 'responded_at', t.responded_at, 'local_date', t.local_date,
                          'due_on_before', t.due_on_before, 'due_on_after', t.due_on_after, 'interval_days', t.interval_days,
                          'algorithm_version', t.algorithm_version, 'server_seq', t.server_seq) order by t.responded_at), '[]'::jsonb)
                       from public.recall_attempts t
                       where t.user_id = v_uid and t.server_seq > v_since and (not v_full or t.local_date >= public.user_today(v_uid) - 90)),
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
      coalesce((select max(c.server_seq) from public.recall_cards c where c.user_id = v_uid), 0),
      coalesce((select max(t.server_seq) from public.recall_attempts t where t.user_id = v_uid), 0),
      coalesce((select max(d.server_seq) from public.discovery_topics d where d.user_id = v_uid), 0),
      coalesce((select max(f.server_seq) from public.topic_feedback f where f.user_id = v_uid), 0),
      coalesce((select max(x.server_seq) from public.experiments x where x.user_id = v_uid), 0),
      coalesce((select p.server_seq from public.profiles p where p.id = v_uid), 0))
  );
end;
$$;
