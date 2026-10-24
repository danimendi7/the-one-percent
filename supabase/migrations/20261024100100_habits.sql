-- THE ONE PERCENT · M2 · 2/4 · Habit engine
-- habits, versioned schedules, entries and the rest-day calendar, with integrity enforced in the DB.

create table public.habits (
  -- Client-generated UUID so creation is idempotent across retries and devices.
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dimension_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  icon text not null default 'check' check (char_length(icon) between 1 and 32),
  habit_type text not null check (habit_type in ('binary', 'numeric', 'duration')),
  unit text check (char_length(unit) <= 24),
  target_value numeric check (target_value >= 0),
  target_direction text check (target_direction in ('at_least', 'at_most')),
  priority smallint not null default 0,
  start_date date not null,
  archived_on date,
  -- Optimistic concurrency for edits (conflict detection between devices).
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default nextval('public.change_seq'),
  unique (id, user_id),
  foreign key (dimension_id, user_id) references public.dimensions (id, user_id),
  constraint habits_target_shape check (
    (habit_type = 'binary' and target_value is null and target_direction is null)
    or (habit_type <> 'binary' and target_value is not null and target_direction is not null)
  ),
  constraint habits_archive_after_start check (archived_on is null or archived_on >= start_date)
);
create index habits_user_seq on public.habits (user_id, server_seq);

create table public.habit_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null,
  user_id uuid not null default auth.uid(),
  -- A version applies from valid_from until the day before the next version (valid_until is derived).
  valid_from date not null,
  schedule_kind text not null check (schedule_kind in ('daily', 'weekdays', 'weekly_count')),
  weekdays smallint[],
  target_count smallint,
  created_at timestamptz not null default now(),
  foreign key (habit_id, user_id) references public.habits (id, user_id) on delete cascade,
  unique (habit_id, valid_from),
  constraint schedule_shape check (
    (schedule_kind = 'daily' and weekdays is null and target_count is null)
    or (schedule_kind = 'weekdays' and target_count is null and cardinality(weekdays) between 1 and 7
        and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
    or (schedule_kind = 'weekly_count' and weekdays is null and target_count between 1 and 7)
  )
);

create table public.habit_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  habit_id uuid not null,
  local_date date not null,
  value_bool boolean,
  value_numeric numeric check (value_numeric >= 0),
  rating smallint check (rating between 1 and 10),
  note text check (char_length(note) <= 500),
  -- Provenance for activities that feed habits (reading/focus sessions, M3/M4).
  source_activity_type text,
  source_activity_id uuid,
  client_op_id text not null,
  -- Device time of the user's intent: last-writer-wins key between devices.
  client_updated_at timestamptz not null,
  -- Clearing a value is a soft delete so the change propagates to other devices.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default nextval('public.change_seq'),
  foreign key (habit_id, user_id) references public.habits (id, user_id) on delete cascade,
  -- One manual record per habit and day; numeric values are the day's exact total.
  unique (user_id, habit_id, local_date),
  unique (user_id, client_op_id),
  constraint entry_single_value check (not (value_bool is not null and value_numeric is not null)),
  constraint entry_value_present check (deleted_at is not null or value_bool is not null or value_numeric is not null)
);
create index habit_entries_user_seq on public.habit_entries (user_id, server_seq);

create table public.routine_calendar (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_date date not null,
  rest_flag boolean not null default false,
  template_id uuid,
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default nextval('public.change_seq'),
  unique (user_id, local_date)
);
create index routine_calendar_user_seq on public.routine_calendar (user_id, server_seq);

create trigger habits_touch before insert or update on public.habits
  for each row execute function private.touch_row();
create trigger habit_entries_touch before insert or update on public.habit_entries
  for each row execute function private.touch_row();
create trigger routine_calendar_touch before insert or update on public.routine_calendar
  for each row execute function private.touch_row();

-- ── Schedule evaluation (mirrors src/features/habits/domain/schedule.ts) ─
create or replace function public.habit_is_eligible(p_habit uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select case v.schedule_kind
      when 'daily' then true
      when 'weekly_count' then true
      when 'weekdays' then extract(isodow from p_date)::smallint = any (v.weekdays)
    end
    from public.habit_schedule_versions v
    join public.habits h on h.id = v.habit_id
    where v.habit_id = p_habit
      and v.valid_from <= p_date
      and p_date >= h.start_date
      and (h.archived_on is null or p_date < h.archived_on)
    order by v.valid_from desc
    limit 1
  ), false);
$$;

-- ── Integrity guards ─────────────────────────────────────────────────────
create or replace function private.guard_habit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.start_date > public.user_today(new.user_id) + 1 then
    raise exception 'start_in_future' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.id <> old.id then
      raise exception 'immutable_identity' using errcode = 'P0001';
    end if;
    if new.habit_type <> old.habit_type then
      raise exception 'immutable_habit_type' using errcode = 'P0001';
    end if;
    if new.start_date <> old.start_date then
      raise exception 'immutable_start_date' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger habits_guard before insert or update on public.habits
  for each row execute function private.guard_habit();

-- Versions are append-only history. They can be added or superseded only from
-- "today" onward, except while the habit itself is being created (imports).
create or replace function private.guard_schedule_version()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_habit public.habits;
  v_row public.habit_schedule_versions;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  select * into v_habit from public.habits h where h.id = v_row.habit_id;
  if not found then
    -- Parent is being deleted (cascade): allow.
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'versions_append_only' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and new.valid_from < v_habit.start_date then
    raise exception 'version_before_start' using errcode = 'P0001';
  end if;
  if v_habit.created_at <> now()
     and v_row.valid_from < public.user_today(v_row.user_id) - 1 then
    raise exception 'history_immutable' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger schedule_versions_guard before insert or update or delete on public.habit_schedule_versions
  for each row execute function private.guard_schedule_version();

create or replace function private.guard_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
begin
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.habit_id <> old.habit_id or new.local_date <> old.local_date) then
    raise exception 'immutable_identity' using errcode = 'P0001';
  end if;
  select h.habit_type into v_type from public.habits h where h.id = new.habit_id and h.user_id = new.user_id;
  if not found then
    raise exception 'habit_not_found' using errcode = 'P0001';
  end if;
  if new.local_date > public.user_today(new.user_id) then
    raise exception 'future_date' using errcode = 'P0001';
  end if;
  if new.deleted_at is null then
    if not public.habit_is_eligible(new.habit_id, new.local_date) then
      raise exception 'not_eligible' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.routine_calendar r
               where r.user_id = new.user_id and r.local_date = new.local_date and r.rest_flag) then
      raise exception 'rest_day' using errcode = 'P0001';
    end if;
    if v_type = 'binary' and (new.value_bool is distinct from true or new.value_numeric is not null) then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
    if v_type <> 'binary' and (new.value_numeric is null or new.value_bool is not null) then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger habit_entries_guard before insert or update on public.habit_entries
  for each row execute function private.guard_entry();

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.habits enable row level security;
alter table public.habit_schedule_versions enable row level security;
alter table public.habit_entries enable row level security;
alter table public.routine_calendar enable row level security;

create policy "habits: read own" on public.habits for select to authenticated
  using (user_id = (select auth.uid()));
create policy "habits: insert own" on public.habits for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "habits: update own" on public.habits for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "versions: read own" on public.habit_schedule_versions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "versions: insert own" on public.habit_schedule_versions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "versions: delete own" on public.habit_schedule_versions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "entries: read own" on public.habit_entries for select to authenticated
  using (user_id = (select auth.uid()));
create policy "entries: insert own" on public.habit_entries for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "entries: update own" on public.habit_entries for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "calendar: read own" on public.routine_calendar for select to authenticated
  using (user_id = (select auth.uid()));
create policy "calendar: insert own" on public.routine_calendar for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "calendar: update own" on public.routine_calendar for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Hard deletes are not part of V1 flows (archive / soft delete instead).
revoke all on public.habits, public.habit_schedule_versions, public.habit_entries, public.routine_calendar from anon;
revoke delete, truncate on public.habits, public.habit_entries, public.routine_calendar from authenticated;
revoke update, truncate on public.habit_schedule_versions from authenticated;
