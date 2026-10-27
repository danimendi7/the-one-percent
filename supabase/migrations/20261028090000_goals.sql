-- THE ONE PERCENT · M3.1 · Goals (docs/m3.1-goals-plan.md)
-- Goals never store progress: it is derived on the client from habit entries, measurements and
-- milestones with the same pure functions everywhere. This migration adds the records and the
-- sync operations; it reuses the existing engine (apply_ops idempotency ledger, pull_changes
-- cursor, realtime invalidation). No hard deletes: archive goals, soft-delete children.

-- ── Tables ────────────────────────────────────────────────────────────────
create table public.goals (
  -- Client-generated UUID so creation is idempotent across retries and devices.
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_goal_id uuid,
  dimension_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  why text check (char_length(why) <= 160),
  metric_type text not null check (metric_type in ('habits', 'numeric', 'milestones')),
  -- numeric only
  source text check (source in ('manual', 'habit')),
  source_habit_id uuid,
  aggregation text check (aggregation in ('last', 'sum')),
  unit text check (char_length(unit) between 1 and 24),
  baseline numeric,
  target numeric,
  direction text check (direction in ('up', 'down')),
  -- habits only: completion needed (0–1]
  threshold numeric,
  start_date date not null,
  due_date date not null,
  horizon_override text check (horizon_override in ('short', 'medium', 'long')),
  priority text not null default 'secondary' check (priority in ('primary', 'secondary')),
  aggregate_children boolean not null default false,
  state text not null default 'active' check (state in ('active', 'achieved', 'abandoned')),
  closed_on date,
  archived_on date,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default nextval('public.change_seq'),
  unique (id, user_id),
  -- Composite keys: a goal can only point at the same user's parent, dimension and habit.
  foreign key (parent_goal_id, user_id) references public.goals (id, user_id),
  foreign key (dimension_id, user_id) references public.dimensions (id, user_id),
  foreign key (source_habit_id, user_id) references public.habits (id, user_id),
  constraint goals_dates check (due_date >= start_date),
  constraint goals_not_own_parent check (parent_goal_id is null or parent_goal_id <> id),
  constraint goals_closed check ((state = 'active') = (closed_on is null)),
  constraint goals_shape check (
    (metric_type = 'numeric'
      and source is not null and aggregation is not null and unit is not null
      and baseline is not null and target is not null and direction is not null
      and ((direction = 'up' and target > baseline) or (direction = 'down' and target < baseline))
      and (source = 'habit') = (source_habit_id is not null)
      and threshold is null)
    or (metric_type = 'habits'
      and threshold > 0 and threshold <= 1
      and source is null and source_habit_id is null and aggregation is null and unit is null
      and baseline is null and target is null and direction is null)
    or (metric_type = 'milestones'
      and threshold is null and source is null and source_habit_id is null and aggregation is null
      and unit is null and baseline is null and target is null and direction is null)
  )
);
create index goals_user_seq on public.goals (user_id, server_seq);
create index goals_parent_user on public.goals (parent_goal_id, user_id);
create index goals_dimension_user on public.goals (dimension_id, user_id);
create index goals_source_habit_user on public.goals (source_habit_id, user_id);

-- The "system": habits whose completion is the goal's effort. Many-to-many; links read the
-- habit's own entries, so nothing is logged twice.
create table public.goal_habits (
  goal_id uuid not null,
  habit_id uuid not null,
  user_id uuid not null default auth.uid(),
  weight smallint not null default 1 check (weight between 1 and 3),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default nextval('public.change_seq'),
  primary key (goal_id, habit_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade,
  foreign key (habit_id, user_id) references public.habits (id, user_id)
);
create index goal_habits_habit_user on public.goal_habits (habit_id, user_id);
create index goal_habits_goal_user on public.goal_habits (goal_id, user_id);

-- Intermediate milestones: a flat list, no dependencies between them.
create table public.goal_checkpoints (
  id uuid primary key,
  goal_id uuid not null,
  user_id uuid not null default auth.uid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  sort_order smallint not null default 0,
  due_on date,
  -- Numeric goals: reached automatically when real data crosses this value (never ticked by hand).
  value numeric,
  done_on date,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default nextval('public.change_seq'),
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade,
  constraint checkpoint_value_or_manual check (value is null or done_on is null)
);
create index goal_checkpoints_goal_user on public.goal_checkpoints (goal_id, user_id);

-- One manual measurement per goal and day (desired state: a new value replaces the old one).
create table public.goal_measurements (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null,
  user_id uuid not null default auth.uid(),
  observed_on date not null,
  value numeric,
  note text check (char_length(note) <= 200),
  client_op_id text not null,
  client_updated_at timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default nextval('public.change_seq'),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade,
  unique (goal_id, observed_on),
  constraint measurement_value_present check (deleted_at is not null or value is not null)
);
create index goal_measurements_user_seq on public.goal_measurements (user_id, server_seq);
create index goal_measurements_goal_user on public.goal_measurements (goal_id, user_id);

create trigger goals_touch before insert or update on public.goals
  for each row execute function private.touch_row();
create trigger goal_habits_touch before insert or update on public.goal_habits
  for each row execute function private.touch_row();
create trigger goal_checkpoints_touch before insert or update on public.goal_checkpoints
  for each row execute function private.touch_row();
create trigger goal_measurements_touch before insert or update on public.goal_measurements
  for each row execute function private.touch_row();

-- ── Integrity guards ─────────────────────────────────────────────────────
create or replace function private.guard_goal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.id <> old.id then
      raise exception 'immutable_identity' using errcode = 'P0001';
    end if;
    -- Changing how a goal is measured would rewrite its history: create a new goal instead.
    if new.metric_type <> old.metric_type or new.source is distinct from old.source
       or new.source_habit_id is distinct from old.source_habit_id then
      raise exception 'immutable_measure' using errcode = 'P0001';
    end if;
  end if;
  if new.source_habit_id is not null then
    select h.habit_type into v_type from public.habits h where h.id = new.source_habit_id and h.user_id = new.user_id;
    if v_type = 'binary' then
      raise exception 'source_habit_not_numeric' using errcode = 'P0001';
    end if;
  end if;
  -- No cycles: walking up from the new parent must never reach this goal.
  if new.parent_goal_id is not null and exists (
    with recursive up (id, parent) as (
      select g.id, g.parent_goal_id from public.goals g where g.id = new.parent_goal_id and g.user_id = new.user_id
      union
      select g.id, g.parent_goal_id from public.goals g join up on g.id = up.parent
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'goal_cycle' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger goals_guard before insert or update on public.goals
  for each row execute function private.guard_goal();

create or replace function private.guard_goal_measurement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_goal public.goals;
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.goal_id <> old.goal_id or new.observed_on <> old.observed_on) then
    raise exception 'immutable_identity' using errcode = 'P0001';
  end if;
  select * into v_goal from public.goals g where g.id = new.goal_id and g.user_id = new.user_id;
  if not found then
    raise exception 'goal_not_found' using errcode = 'P0001';
  end if;
  if new.deleted_at is null then
    -- A habit-fed goal reads the habit's entries: a manual value would count twice.
    if v_goal.metric_type <> 'numeric' or v_goal.source <> 'manual' then
      raise exception 'not_manual' using errcode = 'P0001';
    end if;
    if new.observed_on > public.user_today(new.user_id) then
      raise exception 'future_date' using errcode = 'P0001';
    end if;
    if new.observed_on < v_goal.start_date then
      raise exception 'before_start' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger goal_measurements_guard before insert or update on public.goal_measurements
  for each row execute function private.guard_goal_measurement();

create or replace function private.guard_goal_checkpoint()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.goal_id <> old.goal_id or new.id <> old.id) then
    raise exception 'immutable_identity' using errcode = 'P0001';
  end if;
  if new.done_on is not null and new.done_on > public.user_today(new.user_id) then
    raise exception 'future_date' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger goal_checkpoints_guard before insert or update on public.goal_checkpoints
  for each row execute function private.guard_goal_checkpoint();

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.goals enable row level security;
alter table public.goal_habits enable row level security;
alter table public.goal_checkpoints enable row level security;
alter table public.goal_measurements enable row level security;

create policy "goals: read own" on public.goals for select to authenticated
  using (user_id = (select auth.uid()));
create policy "goals: insert own" on public.goals for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "goals: update own" on public.goals for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "goal_habits: read own" on public.goal_habits for select to authenticated
  using (user_id = (select auth.uid()));
create policy "goal_habits: insert own" on public.goal_habits for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "goal_habits: update own" on public.goal_habits for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "checkpoints: read own" on public.goal_checkpoints for select to authenticated
  using (user_id = (select auth.uid()));
create policy "checkpoints: insert own" on public.goal_checkpoints for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "checkpoints: update own" on public.goal_checkpoints for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "measurements: read own" on public.goal_measurements for select to authenticated
  using (user_id = (select auth.uid()));
create policy "measurements: insert own" on public.goal_measurements for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "measurements: update own" on public.goal_measurements for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.goals, public.goal_habits, public.goal_checkpoints, public.goal_measurements from anon;
revoke delete, truncate on public.goals, public.goal_habits, public.goal_checkpoints, public.goal_measurements from authenticated;

-- Realtime: links and milestones bump their goal's server_seq, so goals + measurements suffice.
alter publication supabase_realtime add table public.goals, public.goal_measurements;

-- ── Operations ───────────────────────────────────────────────────────────
-- Replaces the goal's links and milestone definitions with the given lists (desired state).
-- Milestone completion is NOT taken from here except on creation: it has its own operation.
create or replace function private.sync_goal_children(p_uid uuid, p_goal uuid, p_habits jsonb, p_checkpoints jsonb, p_creating boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_link jsonb;
  v_cp jsonb;
  v_i int := 0;
begin
  if jsonb_typeof(coalesce(p_habits, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_checkpoints, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_children' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_checkpoints, '[]'::jsonb)) > 50 or jsonb_array_length(coalesce(p_habits, '[]'::jsonb)) > 50 then
    raise exception 'too_many_children' using errcode = 'P0001';
  end if;

  update public.goal_habits l set deleted_at = now()
    where l.goal_id = p_goal and l.user_id = p_uid and l.deleted_at is null
      and not exists (select 1 from jsonb_array_elements(coalesce(p_habits, '[]'::jsonb)) x where (x ->> 'habit_id')::uuid = l.habit_id);
  for v_link in select * from jsonb_array_elements(coalesce(p_habits, '[]'::jsonb)) loop
    insert into public.goal_habits (goal_id, habit_id, user_id, weight)
    values (p_goal, (v_link ->> 'habit_id')::uuid, p_uid, coalesce((v_link ->> 'weight')::smallint, 1))
    on conflict (goal_id, habit_id) do update
      set weight = excluded.weight, deleted_at = null
      where public.goal_habits.weight is distinct from excluded.weight or public.goal_habits.deleted_at is not null;
  end loop;

  update public.goal_checkpoints c set deleted_at = now()
    where c.goal_id = p_goal and c.user_id = p_uid and c.deleted_at is null
      and not exists (select 1 from jsonb_array_elements(coalesce(p_checkpoints, '[]'::jsonb)) x where (x ->> 'id')::uuid = c.id);
  for v_cp in select * from jsonb_array_elements(coalesce(p_checkpoints, '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.goal_checkpoints (id, goal_id, user_id, title, sort_order, due_on, value, done_on)
    values (
      (v_cp ->> 'id')::uuid, p_goal, p_uid, btrim(v_cp ->> 'title'), v_i,
      (v_cp ->> 'due_on')::date, (v_cp ->> 'value')::numeric,
      case when p_creating and (v_cp ->> 'value') is null then (v_cp ->> 'done_on')::date end
    )
    on conflict (id) do update
      set title = excluded.title, sort_order = excluded.sort_order, due_on = excluded.due_on,
          value = excluded.value, deleted_at = null,
          -- A milestone that gains a value becomes data-driven: drop any manual tick.
          done_on = case when excluded.value is not null then null else public.goal_checkpoints.done_on end
      where public.goal_checkpoints.goal_id = p_goal and public.goal_checkpoints.user_id = p_uid;
    if not found then
      raise exception 'id_conflict' using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

create or replace function private.goal_row(p_uid uuid, p_goal jsonb, out r public.goals)
language plpgsql
set search_path = ''
as $$
begin
  r.user_id := p_uid;
  r.title := btrim(p_goal ->> 'title');
  r.why := nullif(btrim(coalesce(p_goal ->> 'why', '')), '');
  r.parent_goal_id := (p_goal ->> 'parent_id')::uuid;
  if p_goal ->> 'dimension' is not null then
    select d.id into r.dimension_id from public.dimensions d where d.user_id = p_uid and d.slug = p_goal ->> 'dimension';
    if r.dimension_id is null then raise exception 'invalid_dimension' using errcode = 'P0001'; end if;
  end if;
  r.metric_type := p_goal ->> 'metric_type';
  r.source := p_goal ->> 'source';
  r.source_habit_id := (p_goal ->> 'source_habit_id')::uuid;
  r.aggregation := p_goal ->> 'aggregation';
  r.unit := nullif(btrim(coalesce(p_goal ->> 'unit', '')), '');
  r.baseline := (p_goal ->> 'baseline')::numeric;
  r.target := (p_goal ->> 'target')::numeric;
  r.direction := p_goal ->> 'direction';
  r.threshold := (p_goal ->> 'threshold')::numeric;
  r.start_date := (p_goal ->> 'start_date')::date;
  r.due_date := (p_goal ->> 'due_date')::date;
  r.horizon_override := p_goal ->> 'horizon_override';
  r.priority := coalesce(p_goal ->> 'priority', 'secondary');
  r.aggregate_children := coalesce((p_goal ->> 'aggregate_children')::boolean, false);
end;
$$;

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

revoke all on function private.apply_goal_op(uuid, text, jsonb) from public, anon;
revoke all on function private.sync_goal_children(uuid, uuid, jsonb, jsonb, boolean) from public, anon;
revoke all on function private.goal_row(uuid, jsonb) from public, anon;
grant execute on function private.apply_goal_op(uuid, text, jsonb) to authenticated;
grant execute on function private.sync_goal_children(uuid, uuid, jsonb, jsonb, boolean) to authenticated;
grant execute on function private.goal_row(uuid, jsonb) to authenticated;

-- ── apply_ops: same ledger, goal ops routed to apply_goal_op ─────────────
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

-- ── pull_changes: + goals (with links and milestones) and measurements ───
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
    'cursor', greatest(v_since,
      coalesce((select max(h.server_seq) from public.habits h where h.user_id = v_uid), 0),
      coalesce((select max(e.server_seq) from public.habit_entries e where e.user_id = v_uid), 0),
      coalesce((select max(r.server_seq) from public.routine_calendar r where r.user_id = v_uid), 0),
      coalesce((select max(g.server_seq) from public.goals g where g.user_id = v_uid), 0),
      coalesce((select max(m.server_seq) from public.goal_measurements m where m.user_id = v_uid), 0),
      coalesce((select p.server_seq from public.profiles p where p.id = v_uid), 0))
  );
end;
$$;
