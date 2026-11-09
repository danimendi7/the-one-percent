-- C5 · Life Review: daily reviews (Plan Maestro 5.8: cumplimiento, observaciones y ajustes inmediatos).
-- Additive: week and month rows, their rules and their operations do not change.
--   - One more value of `kind`, whose period is a single date. The text sections are its two
--     questions; decisions and evaluations stay with weeks and months.
--   - `pull_changes` keeps `reviews` for weeks and months and adds `daily_reviews`. A client published
--     before this migration ignores the new key, so it never receives a kind it does not know.
--   - `apply_ops` and `review_op` need no change: they take the period from `review_period` and the
--     valid sections from `review_content_keys`, and a daily snapshot has the shape already checked.

alter table public.reviews drop constraint reviews_kind_check;
alter table public.reviews add constraint reviews_kind_check check (kind in ('day', 'week', 'month'));
alter table public.reviews add constraint reviews_day_period check (kind <> 'day' or period_end = period_start);
alter table public.reviews add constraint reviews_day_text_only check (kind <> 'day' or (decisions = '[]'::jsonb and evaluations = '[]'::jsonb));

create or replace function private.review_content_keys(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'day' then array['observations', 'adjustments']
    when 'week' then array['wins', 'struggles', 'lessons', 'note']
    when 'month' then array['pattern', 'attention', 'stop', 'note']
  end
$$;

-- Period identity and availability (D49), now also for days: any date up to today in the profile timezone.
create or replace function private.review_period(p_uid uuid, p_op jsonb, out kind text, out period_start date, out period_end date)
language plpgsql
stable
set search_path = ''
as $$
begin
  kind := p_op ->> 'kind';
  if kind is null or kind not in ('day', 'week', 'month') or jsonb_typeof(p_op -> 'period_start') is distinct from 'string'
     or (p_op ->> 'period_start') !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(p_op ->> 'period_start', 'date') then
    raise exception 'invalid_period' using errcode = 'P0001';
  end if;
  period_start := (p_op ->> 'period_start')::date;
  if kind = 'day' then
    period_end := period_start;
  elsif kind = 'week' and extract(isodow from period_start) = 1 then
    period_end := period_start + 6;
  elsif kind = 'month' and extract(day from period_start) = 1 then
    period_end := (period_start + interval '1 month' - interval '1 day')::date;
  else
    raise exception 'invalid_period' using errcode = 'P0001';
  end if;
  if period_end > public.user_today(p_uid) then
    raise exception 'not_available' using errcode = 'P0001';
  end if;
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
