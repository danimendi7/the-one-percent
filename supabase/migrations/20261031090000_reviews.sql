-- M3.4b · Life Review (docs/m3.4-life-review-plan.md §3 and §16, decisions D49–D54). Additive only:
-- one new table, new private functions and new branches in apply_ops / pull_changes. Published
-- clients ignore the new pull key and never send review operations.
--
-- Trust model (§16):
-- - The table is written ONLY through private.apply_review_op (called by apply_ops as the user,
--   security invoker): its trigger refuses any write without the transaction-local flag that the
--   function sets, so a direct REST insert/update can neither create a closed review nor touch one.
-- - The server checks the period, its availability, the review state, the snapshot's shape,
--   identity and size, and that the snapshot was computed after the user's latest data change
--   (based_on_cursor). It cannot recompute the figures (they come from the TypeScript domain): a
--   user can only ever affect their own review.

-- ── Table ────────────────────────────────────────────────────────────────
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('week', 'month')),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'closed')),
  -- Answers by key (week: wins, struggles, lessons, note | month: pattern, attention, stop, note).
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  -- ≤ 3: {id, text, kind start|keep|change|drop, expected?, link {type habit|goal, id, title}?}
  decisions jsonb not null default '[]'::jsonb check (jsonb_typeof(decisions) = 'array'),
  -- Ratings of the previous review's decisions (decision 4): {decisionId, from, outcome, note?}
  evaluations jsonb not null default '[]'::jsonb check (jsonb_typeof(evaluations) = 'array'),
  -- server_seq of the last change of each section: the conflict base (decision 5). Trigger-owned.
  field_seqs jsonb not null default '{}'::jsonb check (jsonb_typeof(field_seqs) = 'object'),
  snapshot jsonb,
  metrics_version integer check (metrics_version between 1 and 1000),
  snapshot_version integer check (snapshot_version between 1 and 1000),
  timezone text,
  -- Server clock of the close (set by the trigger, never by the client).
  closed_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null default nextval('public.change_seq'),
  -- D49: one review per user, kind and period.
  constraint reviews_one_per_period unique (user_id, kind, period_start),
  constraint reviews_week_period check (kind <> 'week' or (extract(isodow from period_start) = 1 and period_end = period_start + 6)),
  constraint reviews_month_period check (kind <> 'month' or (extract(day from period_start) = 1
                                         and period_end = (period_start + interval '1 month' - interval '1 day')::date)),
  constraint reviews_closed_frozen check ((status = 'closed') = (snapshot is not null and closed_at is not null
                                         and metrics_version is not null and snapshot_version is not null and timezone is not null)),
  constraint reviews_snapshot_size check (snapshot is null or octet_length(snapshot::text) <= 65536)
);
create index reviews_user_seq on public.reviews (user_id, server_seq);

-- ── Validation (mirrors src/features/reviews/domain/content.ts) ──────────
create or replace function private.review_content_keys(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'week' then array['wins', 'struggles', 'lessons', 'note']
    when 'month' then array['pattern', 'attention', 'stop', 'note']
  end
$$;

-- A stored text: a JSON string, already trimmed, 1..p_max characters.
create or replace function private.review_text_ok(p jsonb, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p) = 'string'
         and char_length(p #>> '{}') between 1 and p_max
         and (p #>> '{}') = btrim(p #>> '{}', E' \t\r\n'), false)
$$;

create or replace function private.review_uuid_ok(p jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p) = 'string' and pg_input_is_valid(p #>> '{}', 'uuid'), false)
$$;

create or replace function private.valid_review_content(p_kind text, p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  for v_key, v_val in select e.key, e.value from jsonb_each(p) e loop
    if not (v_key = any (private.review_content_keys(p_kind))) then return false; end if;
    if not private.review_text_ok(v_val, case when v_key = 'note' then 1000 else 600 end) then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function private.valid_review_decisions(p jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_d jsonb;
  v_link jsonb;
  v_ids text[] := '{}'::text[];
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) > 3 then return false; end if;
  for v_d in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(v_d) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v_d) k where k not in ('id', 'text', 'kind', 'expected', 'link')) then return false; end if;
    if not private.review_uuid_ok(v_d -> 'id') or (v_d ->> 'id') = any (v_ids) then return false; end if;
    v_ids := v_ids || (v_d ->> 'id');
    if not private.review_text_ok(v_d -> 'text', 140) then return false; end if;
    if jsonb_typeof(v_d -> 'kind') is distinct from 'string' or (v_d ->> 'kind') not in ('start', 'keep', 'change', 'drop') then return false; end if;
    if coalesce(jsonb_typeof(v_d -> 'expected'), 'null') <> 'null' and not private.review_text_ok(v_d -> 'expected', 80) then return false; end if;
    v_link := v_d -> 'link';
    if coalesce(jsonb_typeof(v_link), 'null') <> 'null' then
      if jsonb_typeof(v_link) <> 'object' then return false; end if;
      if exists (select 1 from jsonb_object_keys(v_link) k where k not in ('type', 'id', 'title')) then return false; end if;
      if jsonb_typeof(v_link -> 'type') is distinct from 'string' or (v_link ->> 'type') not in ('habit', 'goal') then return false; end if;
      if not private.review_uuid_ok(v_link -> 'id') or not private.review_text_ok(v_link -> 'title', 120) then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function private.valid_review_evaluations(p jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_e jsonb;
  v_ids text[] := '{}'::text[];
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) > 3 then return false; end if;
  for v_e in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(v_e) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v_e) k where k not in ('decisionId', 'from', 'outcome', 'note')) then return false; end if;
    if not private.review_uuid_ok(v_e -> 'decisionId') or (v_e ->> 'decisionId') = any (v_ids) then return false; end if;
    v_ids := v_ids || (v_e ->> 'decisionId');
    if jsonb_typeof(v_e -> 'from') is distinct from 'string' or (v_e ->> 'from') !~ '^\d{4}-\d{2}-\d{2}$'
       or not pg_input_is_valid(v_e ->> 'from', 'date') then
      return false;
    end if;
    if jsonb_typeof(v_e -> 'outcome') is distinct from 'string' or (v_e ->> 'outcome') not in ('done', 'partial', 'missed', 'dropped') then return false; end if;
    if coalesce(jsonb_typeof(v_e -> 'note'), 'null') <> 'null' and not private.review_text_ok(v_e -> 'note', 140) then return false; end if;
  end loop;
  return true;
end;
$$;

-- Shape and identity of a frozen snapshot (snapshot_version 1, src/features/reviews/domain/snapshot.ts).
-- The figures themselves cannot be recomputed here: see the trust model at the top.
create or replace function private.valid_review_snapshot(p_kind text, p_start date, p_end date, p jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(p) = 'object'
    and octet_length(p::text) <= 65536
    and p -> 'v' = '1'::jsonb
    and jsonb_typeof(p -> 'metricsVersion') = 'number'
    and pg_input_is_valid(p ->> 'metricsVersion', 'integer')
    and (p ->> 'metricsVersion')::numeric between 1 and 1000
    and p ->> 'kind' = p_kind
    and p #>> '{period,from}' = p_start::text
    and p #>> '{period,to}' = p_end::text
    -- A review closes from its last day on, so its figures always run to the period end.
    and p ->> 'asOf' = p_end::text
    and jsonb_typeof(p -> 'timezone') = 'string'
    and private.is_valid_timezone(p ->> 'timezone')
    and jsonb_typeof(p -> 'computedAt') = 'string'
    and pg_input_is_valid(p ->> 'computedAt', 'timestamptz')
    and jsonb_typeof(p -> 'habits') = 'object'
    and jsonb_typeof(p -> 'goals') = 'array'
    and jsonb_typeof(p -> 'focus') = 'object'
    and jsonb_typeof(p -> 'mind') = 'object'
    and (p_kind <> 'month' or jsonb_typeof(p -> 'weekly') = 'array'),
    false)
$$;

-- ── Guard: identity, immutability, validation, sequence and section versions ──
create or replace function private.guard_review()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_seqs jsonb := '{}'::jsonb;
  v_key text;
  v_old_content jsonb := '{}'::jsonb;
  v_old_decisions jsonb := '[]'::jsonb;
  v_old_evaluations jsonb := '[]'::jsonb;
begin
  -- Only private.apply_review_op writes reviews (transaction-local flag): no direct API writes.
  if coalesce(current_setting('top.review_op', true), '') <> 'on' then
    raise exception 'reviews_via_ops_only' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.id <> old.id or new.user_id <> old.user_id or new.kind <> old.kind
     or new.period_start <> old.period_start or new.period_end <> old.period_end or new.created_at <> old.created_at) then
    raise exception 'immutable_identity' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and (new.status <> 'draft' or new.snapshot is not null or new.deleted_at is not null) then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  -- D52: a closed review is immutable. The only change it accepts is the explicit delete.
  if tg_op = 'UPDATE' and old.status = 'closed' and old.deleted_at is null and new.deleted_at is null then
    raise exception 'review_closed' using errcode = 'P0001';
  end if;
  -- A tombstone keeps no personal content.
  if new.deleted_at is not null and (new.status <> 'draft' or new.content <> '{}'::jsonb or new.decisions <> '[]'::jsonb
     or new.evaluations <> '[]'::jsonb or new.snapshot is not null) then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;
  if not private.valid_review_content(new.kind, new.content)
     or not private.valid_review_decisions(new.decisions)
     or not private.valid_review_evaluations(new.evaluations) then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    if not private.valid_review_snapshot(new.kind, new.period_start, new.period_end, new.snapshot) then
      raise exception 'invalid_snapshot' using errcode = 'P0001';
    end if;
    new.closed_at := now();
  end if;

  new.server_seq := nextval('public.change_seq');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.version := old.version + 1;
    -- A live row keeps its section versions; a revived tombstone starts from scratch.
    if old.deleted_at is null then
      v_seqs := old.field_seqs;
      v_old_content := old.content;
      v_old_decisions := old.decisions;
      v_old_evaluations := old.evaluations;
    end if;
  end if;
  foreach v_key in array private.review_content_keys(new.kind) loop
    if (new.content -> v_key) is distinct from (v_old_content -> v_key) then
      v_seqs := jsonb_set(v_seqs, array['content.' || v_key], to_jsonb(new.server_seq));
    end if;
  end loop;
  if new.decisions is distinct from v_old_decisions then
    v_seqs := jsonb_set(v_seqs, '{decisions}', to_jsonb(new.server_seq));
  end if;
  if new.evaluations is distinct from v_old_evaluations then
    v_seqs := jsonb_set(v_seqs, '{evaluations}', to_jsonb(new.server_seq));
  end if;
  new.field_seqs := case when new.deleted_at is not null then '{}'::jsonb else v_seqs end;
  return new;
end;
$$;
create trigger reviews_guard before insert or update on public.reviews
  for each row execute function private.guard_review();

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.reviews enable row level security;

create policy "reviews: read own" on public.reviews for select to authenticated
  using (user_id = (select auth.uid()));
create policy "reviews: insert own" on public.reviews for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "reviews: update own" on public.reviews for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.reviews from anon;
revoke delete, truncate on public.reviews from authenticated;

alter publication supabase_realtime add table public.reviews;

-- ── Operations ───────────────────────────────────────────────────────────
-- Period identity and availability (D49): a Monday or a 1st, and its last day already reached
-- in the profile timezone. Raises; apply_ops records a deterministic rejection.
create or replace function private.review_period(p_uid uuid, p_op jsonb, out kind text, out period_start date, out period_end date)
language plpgsql
stable
set search_path = ''
as $$
begin
  kind := p_op ->> 'kind';
  if kind is null or kind not in ('week', 'month') or jsonb_typeof(p_op -> 'period_start') is distinct from 'string'
     or (p_op ->> 'period_start') !~ '^\d{4}-\d{2}-\d{2}$' or not pg_input_is_valid(p_op ->> 'period_start', 'date') then
    raise exception 'invalid_period' using errcode = 'P0001';
  end if;
  period_start := (p_op ->> 'period_start')::date;
  if kind = 'week' and extract(isodow from period_start) = 1 then
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

-- Latest change of any data a snapshot is computed from (everything pull_changes sends but reviews).
create or replace function private.review_data_cursor(p_uid uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce((select max(h.server_seq) from public.habits h where h.user_id = p_uid), 0),
    coalesce((select max(e.server_seq) from public.habit_entries e where e.user_id = p_uid), 0),
    coalesce((select max(r.server_seq) from public.routine_calendar r where r.user_id = p_uid), 0),
    coalesce((select max(g.server_seq) from public.goals g where g.user_id = p_uid), 0),
    coalesce((select max(m.server_seq) from public.goal_measurements m where m.user_id = p_uid), 0),
    coalesce((select max(f.server_seq) from public.focus_sessions f where f.user_id = p_uid), 0),
    coalesce((select max(c.server_seq) from public.daily_checkins c where c.user_id = p_uid), 0),
    coalesce((select p.server_seq from public.profiles p where p.id = p_uid), 0))
$$;

-- Mirrors src/features/reviews/domain/close.ts (closeGate, applyClose, applyEdit).
create or replace function private.review_op(p_uid uuid, p_type text, p_op jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p record;
  v_row public.reviews;
  v_created boolean := false;
  v_n integer;
  v_fields jsonb;
  v_bases jsonb;
  v_key text;
  v_val jsonb;
  v_cur jsonb;
  v_cur_seq bigint;
  v_conflicts text[] := '{}'::text[];
  v_content jsonb;
  v_decisions jsonb;
  v_evaluations jsonb;
  v_prev_start date;
  v_text text;
  v_snapshot jsonb;
  v_tz text;
  v_based bigint;
begin
  select * into v_p from private.review_period(p_uid, p_op);

  if p_type = 'review.delete' then
    -- D52: exceptional, explicit and confirmed; never produced by sync or conflicts.
    if p_op ->> 'confirm' is distinct from 'delete' then
      raise exception 'confirmation_required' using errcode = 'P0001';
    end if;
    select * into v_row from public.reviews r
      where r.user_id = p_uid and r.kind = v_p.kind and r.period_start = v_p.period_start for update;
    if not found or v_row.deleted_at is not null then
      return jsonb_build_object('outcome', 'applied');
    end if;
    -- Only the exact version the user saw when confirming: a queued delete never removes later work.
    if (p_op ->> 'base_seq') is null or (p_op ->> 'base_seq')::bigint <> v_row.server_seq then
      return jsonb_build_object('outcome', 'conflict', 'code', 'review_changed');
    end if;
    update public.reviews r set deleted_at = now(), status = 'draft', content = '{}'::jsonb, decisions = '[]'::jsonb,
      evaluations = '[]'::jsonb, snapshot = null, metrics_version = null, snapshot_version = null, timezone = null, closed_at = null
      where r.id = v_row.id;
    perform private.audit(p_uid, 'review', v_row.id, 'delete', jsonb_build_object('kind', v_p.kind, 'was', v_row.status));
    return jsonb_build_object('outcome', 'applied');
  end if;

  if p_type not in ('review.save', 'review.close') then
    raise exception 'unknown_op_type' using errcode = 'P0001';
  end if;

  -- Two devices creating the same review: the unique constraint serializes them, both end on one row.
  insert into public.reviews (user_id, kind, period_start, period_end)
    values (p_uid, v_p.kind, v_p.period_start, v_p.period_end)
    on conflict (user_id, kind, period_start) do nothing;
  get diagnostics v_n = row_count;
  v_created := v_n = 1;
  select * into v_row from public.reviews r
    where r.user_id = p_uid and r.kind = v_p.kind and r.period_start = v_p.period_start for update;

  if p_type = 'review.save' then
    v_fields := p_op -> 'fields';
    v_bases := coalesce(p_op -> 'base_seqs', '{}'::jsonb);
    if jsonb_typeof(v_fields) is distinct from 'object' or v_fields = '{}'::jsonb or jsonb_typeof(v_bases) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_fields) k
                  where k not in ('decisions', 'evaluations')
                    and not (k like 'content.%' and substr(k, 9) = any (private.review_content_keys(v_p.kind)))) then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
    -- A late or replayed edit never reopens or changes a closed review (D52).
    if v_row.status = 'closed' and v_row.deleted_at is null then
      return jsonb_build_object('outcome', 'rejected', 'code', 'review_closed');
    end if;
    -- An edit written before a delete does not bring the review back by itself.
    if v_row.deleted_at is not null and exists (select 1 from jsonb_each(v_bases) b where jsonb_typeof(b.value) <> 'null') then
      return jsonb_build_object('outcome', 'conflict', 'code', 'review_deleted');
    end if;

    v_content := case when v_row.deleted_at is null then v_row.content else '{}'::jsonb end;
    v_decisions := case when v_row.deleted_at is null then v_row.decisions else '[]'::jsonb end;
    v_evaluations := case when v_row.deleted_at is null then v_row.evaluations else '[]'::jsonb end;

    for v_key, v_val in select k, v from jsonb_each(v_fields) as t(k, v) loop
      if v_key like 'content.%' then
        if jsonb_typeof(v_val) not in ('string', 'null') then raise exception 'invalid_value' using errcode = 'P0001'; end if;
        -- Same normalization as normalizeContent(): trimmed; empty means «no answer».
        v_text := nullif(btrim(coalesce(v_val #>> '{}', ''), E' \t\r\n'), '');
        v_val := to_jsonb(v_text);
        v_cur := v_content -> substr(v_key, 9);
      elsif v_key = 'decisions' then
        v_cur := v_decisions;
      else
        v_cur := v_evaluations;
      end if;
      -- Section conflict (decision 5): another device changed this section since this edit's base.
      v_cur_seq := case when v_row.deleted_at is null then (v_row.field_seqs ->> v_key)::bigint end;
      if v_cur_seq is not null and v_cur_seq is distinct from (v_bases ->> v_key)::bigint
         and coalesce(v_cur, 'null'::jsonb) is distinct from coalesce(v_val, 'null'::jsonb) then
        v_conflicts := v_conflicts || v_key;
        continue;
      end if;
      if v_key like 'content.%' then
        v_content := case when v_text is null then v_content - substr(v_key, 9) else jsonb_set(v_content, array[substr(v_key, 9)], v_val) end;
      elsif v_key = 'decisions' then
        v_decisions := v_val;
      else
        v_evaluations := v_val;
      end if;
    end loop;
    -- All or nothing: the client keeps the conflicting sections (D47) and resends the others.
    if cardinality(v_conflicts) > 0 then
      return jsonb_build_object('outcome', 'conflict', 'code', 'review_field_conflict', 'fields', to_jsonb(v_conflicts));
    end if;

    if not private.valid_review_decisions(v_decisions) or not private.valid_review_evaluations(v_evaluations) then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
    -- Linked habits and goals belong to the same user (RLS hides the others anyway).
    if exists (select 1 from jsonb_array_elements(v_decisions) d
               where jsonb_typeof(d -> 'link') = 'object'
                 and not exists (select 1 from public.habits h where d #>> '{link,type}' = 'habit' and h.id = (d #>> '{link,id}')::uuid and h.user_id = p_uid)
                 and not exists (select 1 from public.goals g where d #>> '{link,type}' = 'goal' and g.id = (d #>> '{link,id}')::uuid and g.user_id = p_uid)) then
      raise exception 'invalid_link' using errcode = 'P0001';
    end if;
    -- Evaluations rate the previous review of the same kind (decision 4).
    v_prev_start := case when v_p.kind = 'week' then v_p.period_start - 7 else (v_p.period_start - interval '1 month')::date end;
    if exists (select 1 from jsonb_array_elements(v_evaluations) e where (e ->> 'from')::date <> v_prev_start) then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;

    if v_row.deleted_at is null and v_content = v_row.content and v_decisions = v_row.decisions and v_evaluations = v_row.evaluations then
      return jsonb_build_object('outcome', 'applied');
    end if;
    update public.reviews r set content = v_content, decisions = v_decisions, evaluations = v_evaluations, deleted_at = null
      where r.id = v_row.id;
    -- Section names only: never the text of the review in the audit log.
    perform private.audit(p_uid, 'review', v_row.id, 'save', jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(v_fields) k)));
    return jsonb_build_object('outcome', 'applied');
  end if;

  -- review.close (decisions 1, 2 and 4): atomic under the row lock, first close wins.
  if v_row.status = 'closed' and v_row.deleted_at is null then
    return jsonb_build_object('outcome', 'superseded', 'code', 'already_closed');
  end if;
  -- The close freezes exactly the review the user saw (null: it did not exist yet). A tombstone
  -- counts as «no review»: full pulls carry no tombstones, so a device that never saw it sends null
  -- (or, after an incremental pull, the tombstone's own server_seq).
  if (v_created and (p_op ->> 'base_seq') is not null)
     or (not v_created and v_row.deleted_at is not null
         and (p_op ->> 'base_seq') is not null and (p_op ->> 'base_seq') is distinct from v_row.server_seq::text)
     or (not v_created and v_row.deleted_at is null and (p_op ->> 'base_seq') is distinct from v_row.server_seq::text) then
    return jsonb_build_object('outcome', 'conflict', 'code', 'review_changed');
  end if;
  -- Freshness: the snapshot was computed after the user's latest data change on the server.
  if jsonb_typeof(p_op -> 'based_on_cursor') is distinct from 'number' then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;
  v_based := (p_op ->> 'based_on_cursor')::bigint;
  if private.review_data_cursor(p_uid) > v_based then
    return jsonb_build_object('outcome', 'conflict', 'code', 'stale_snapshot');
  end if;
  v_snapshot := p_op -> 'snapshot';
  if not private.valid_review_snapshot(v_p.kind, v_p.period_start, v_p.period_end, v_snapshot) then
    raise exception 'invalid_snapshot' using errcode = 'P0001';
  end if;
  select p.timezone into v_tz from public.profiles p where p.id = p_uid;
  if v_snapshot ->> 'timezone' is distinct from v_tz then
    return jsonb_build_object('outcome', 'conflict', 'code', 'stale_snapshot');
  end if;
  if v_row.deleted_at is not null then
    update public.reviews r set deleted_at = null where r.id = v_row.id;
  end if;
  update public.reviews r set status = 'closed', snapshot = v_snapshot,
    metrics_version = (v_snapshot ->> 'metricsVersion')::integer, snapshot_version = (v_snapshot ->> 'v')::integer, timezone = v_tz
    where r.id = v_row.id;
  perform private.audit(p_uid, 'review', v_row.id, 'close',
    jsonb_build_object('kind', v_p.kind, 'metrics_version', (v_snapshot ->> 'metricsVersion')::integer));
  return jsonb_build_object('outcome', 'applied');
end;
$$;

-- Sets the write flag for this transaction, runs the operation and clears it. If the operation
-- raises, apply_ops rolls its subtransaction back, flag included.
create or replace function private.apply_review_op(p_uid uuid, p_type text, p_op jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_uid is null or p_uid is distinct from auth.uid() then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform set_config('top.review_op', 'on', true);
  v_result := private.review_op(p_uid, p_type, p_op);
  perform set_config('top.review_op', '', true);
  return v_result;
end;
$$;

revoke all on function private.review_content_keys(text) from public, anon;
revoke all on function private.review_text_ok(jsonb, integer) from public, anon;
revoke all on function private.review_uuid_ok(jsonb) from public, anon;
revoke all on function private.valid_review_content(text, jsonb) from public, anon;
revoke all on function private.valid_review_decisions(jsonb) from public, anon;
revoke all on function private.valid_review_evaluations(jsonb) from public, anon;
revoke all on function private.valid_review_snapshot(text, date, date, jsonb) from public, anon;
revoke all on function private.guard_review() from public, anon;
revoke all on function private.review_period(uuid, jsonb) from public, anon;
revoke all on function private.review_data_cursor(uuid) from public, anon;
revoke all on function private.review_op(uuid, text, jsonb) from public, anon;
revoke all on function private.apply_review_op(uuid, text, jsonb) from public, anon;
grant execute on function private.review_content_keys(text) to authenticated;
grant execute on function private.review_text_ok(jsonb, integer) to authenticated;
grant execute on function private.review_uuid_ok(jsonb) to authenticated;
grant execute on function private.valid_review_content(text, jsonb) to authenticated;
grant execute on function private.valid_review_decisions(jsonb) to authenticated;
grant execute on function private.valid_review_evaluations(jsonb) to authenticated;
grant execute on function private.valid_review_snapshot(text, date, date, jsonb) to authenticated;
grant execute on function private.review_period(uuid, jsonb) to authenticated;
grant execute on function private.review_data_cursor(uuid) to authenticated;
grant execute on function private.review_op(uuid, text, jsonb) to authenticated;
grant execute on function private.apply_review_op(uuid, text, jsonb) to authenticated;

-- ── apply_ops: same ledger; review ops routed to apply_review_op; conflicting sections returned ──
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
        || case when v_prev.result ? 'fields' then jsonb_build_object('fields', v_prev.result -> 'fields') else '{}'::jsonb end);
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

    -- `fields` (M3.4): the sections of a review edit that conflicted. Absent for every other op.
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'op_id', v_id, 'status', v_outcome, 'code', v_result ->> 'code')
      || case when v_result ? 'fields' then jsonb_build_object('fields', v_result -> 'fields') else '{}'::jsonb end);
  end loop;

  return jsonb_build_object('results', v_results, 'server_today', public.user_today(v_uid), 'server_time', clock_timestamp());
end;
$$;

-- ── pull_changes: + reviews (with tombstones) and their sequence in the cursor ──
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
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object(
                   'kind', rv.kind, 'period_start', rv.period_start, 'period_end', rv.period_end, 'status', rv.status,
                   'content', rv.content, 'decisions', rv.decisions, 'evaluations', rv.evaluations,
                   'field_seqs', rv.field_seqs, 'snapshot', rv.snapshot, 'metrics_version', rv.metrics_version,
                   'snapshot_version', rv.snapshot_version, 'timezone', rv.timezone, 'closed_at', rv.closed_at,
                   'version', rv.version, 'updated_at', rv.updated_at,
                   'deleted', rv.deleted_at is not null, 'server_seq', rv.server_seq) order by rv.period_start, rv.kind), '[]'::jsonb)
                from public.reviews rv
                where rv.user_id = v_uid and rv.server_seq > v_since and (not v_full or rv.deleted_at is null)),
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
