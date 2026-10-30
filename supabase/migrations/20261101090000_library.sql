-- M4b · Knowledge OS: Library (books and podcast episodes), podcast shows and one knowledge layer
-- (docs/m4-knowledge-os-plan.md §16–§17, decisions D59–D68, N2). Additive only: four new tables,
-- new private functions, a new RPC (pull_library) and new branches in apply_ops / pull_changes.
-- Published clients ignore the new pull key and never send library operations.
--
-- Trust model (same as reviews, D54):
-- - The four tables are written ONLY through private.apply_library_op (called by apply_ops as the
--   user, security invoker): a trigger refuses any write without the transaction-local flag that
--   the function sets. RLS stays on as the second barrier; there is no delete privilege at all.
-- - Every rule of src/features/knowledge/domain/validation.ts is repeated here (CHECKs and the
--   guard trigger); the integration tests feed both the same entities.
-- - Deleted rows are tombstones that keep no personal text (privacy): restoring is an explicit
--   operation that sends the content again. A late edit or create never revives a tombstone.
--
-- Incremental sync (N2): every write takes a per-user transaction lock, and pull_library takes it
-- in shared mode before reading. Library writes of one user therefore commit in server_seq order
-- and a reader never sees a later change while an earlier one is still in flight: paging by
-- server_seq can never leave a change behind the cursor.

-- ── Text helpers (mirror src/features/knowledge/domain/text.ts) ─────────────
-- Accent- and case-insensitive key (Spanish and Latin-1 accents, like normalize()'s fast path).
create or replace function private.lib_norm(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(translate(btrim(p),
    'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcYyy'))
$$;

-- No control characters (cleanText() removes them; tab and line feed are allowed in blocks).
create or replace function private.lib_no_ctrl(p text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$ select p !~ '[\x01-\x08\x0b\x0c\x0d\x0e-\x1f\x7f]' $$;

-- One-line text (cleanLine): 1..max characters, trimmed, no double spaces, no line breaks.
create or replace function private.lib_line_ok(p text, p_max integer)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or (char_length(p) between 1 and p_max and p !~ '^\s' and p !~ '\s$' and p !~ '\s\s'
                       and position(E'\n' in p) = 0 and private.lib_no_ctrl(p))
$$;

-- Block text (cleanText): 1..max characters, trimmed; inner line breaks allowed.
create or replace function private.lib_block_ok(p text, p_max integer)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or (char_length(p) between 1 and p_max and p !~ '^\s' and p !~ '\s$' and private.lib_no_ctrl(p))
$$;

-- A list of clean lines with no duplicates by normalised form (topics, creators).
create or replace function private.lib_list_ok(p text[], p_max_items integer, p_max_len integer)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is not null and cardinality(p) <= p_max_items and array_position(p, null) is null
    and (select bool_and(private.lib_line_ok(x, p_max_len)) from unnest(p) x) is not false
    and (select count(distinct private.lib_norm(x)) from unnest(p) x) = cardinality(p)
$$;

-- http(s) only, no credentials, ≤ 2.048 characters (safeUrl()).
create or replace function private.lib_url_ok(p text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or (char_length(p) <= 2048 and p ~* '^https?://[^\s/?#@]+([/?#][^\s]*)?$')
$$;

create or replace function private.lib_isbn13_ok(p text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_sum integer := 0;
begin
  if p is null then return true; end if;
  if p !~ '^97[89][0-9]{10}$' then return false; end if;
  for i in 1..13 loop
    v_sum := v_sum + substr(p, i, 1)::integer * case when i % 2 = 1 then 1 else 3 end;
  end loop;
  return v_sum % 10 = 0;
end;
$$;

create or replace function private.lib_isbn10_ok(p text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_sum integer := 0;
  v_c text;
begin
  if p is null then return true; end if;
  if p !~ '^[0-9]{9}[0-9X]$' then return false; end if;
  for i in 1..10 loop
    v_c := substr(p, i, 1);
    v_sum := v_sum + (case when v_c = 'X' then 10 else v_c::integer end) * (11 - i);
  end loop;
  return v_sum % 11 = 0;
end;
$$;

-- ── Tables ────────────────────────────────────────────────────────────────
-- Common columns: client-generated id (idempotent creates), owner, per-field versions (conflict
-- bases, trigger-owned), per-field client stamps (hybrid clock, D26/D42), tombstone, sequence.
-- Rules marked «live» do not apply to tombstones, which are emptied of personal text.

create table public.podcast_shows (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) <= 300),
  publisher text check (private.lib_line_ok(publisher, 200)),
  description text check (private.lib_block_ok(description, 10000)),
  topics text[] not null default '{}' check (private.lib_list_ok(topics, 10, 40)),
  cover_source text check (cover_source in ('external', 'upload')),
  cover_ref text,
  source_url text check (private.lib_url_ok(source_url)),
  external_provider text check (external_provider in ('openlibrary', 'googlebooks', 'itunes', 'spotify', 'youtube')),
  external_id text check (char_length(external_id) between 1 and 200),
  external_attribution text check (private.lib_line_ok(external_attribution, 200)),
  field_seqs jsonb not null default '{}'::jsonb check (jsonb_typeof(field_seqs) = 'object'),
  field_stamps jsonb not null default '{}'::jsonb check (jsonb_typeof(field_stamps) = 'object'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null default nextval('public.change_seq'),
  unique (id, user_id),
  constraint shows_live_title check (deleted_at is not null or private.lib_line_ok(title, 300)),
  constraint shows_cover check ((cover_source is null) = (cover_ref is null)
    and (cover_source is distinct from 'external' or private.lib_url_ok(cover_ref))
    and (cover_source is distinct from 'upload' or char_length(cover_ref) between 1 and 500)),
  constraint shows_external check ((external_provider is null) = (external_id is null)
    and (external_attribution is null or external_provider is not null))
);
create index podcast_shows_user_seq on public.podcast_shows (user_id, server_seq);
create unique index podcast_shows_external on public.podcast_shows (user_id, external_provider, external_id)
  where external_id is not null and deleted_at is null;

create table public.library_items (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('book', 'episode')),
  title text not null check (char_length(title) <= 300),
  subtitle text check (private.lib_line_ok(subtitle, 300)),
  creators text[] not null default '{}' check (private.lib_list_ok(creators, 20, 200)),
  description text check (private.lib_block_ok(description, 10000)),
  topics text[] not null default '{}' check (private.lib_list_ok(topics, 10, 40)),
  language text check (private.lib_line_ok(language, 10)),
  status text not null default 'planned' check (status in ('planned', 'active', 'paused', 'done', 'abandoned')),
  favorite boolean not null default false,
  -- D61: optional integer rating from 1 to 10.
  rating smallint check (rating between 1 and 10),
  started_on date,
  finished_on date,
  cover_source text check (cover_source in ('external', 'upload')),
  cover_ref text,
  source_url text check (private.lib_url_ok(source_url)),
  external_provider text check (external_provider in ('openlibrary', 'googlebooks', 'itunes', 'spotify', 'youtube')),
  external_id text check (char_length(external_id) between 1 and 200),
  external_attribution text check (private.lib_line_ok(external_attribution, 200)),
  -- Book only.
  isbn13 text check (private.lib_isbn13_ok(isbn13)),
  isbn10 text check (private.lib_isbn10_ok(isbn10)),
  page_count integer check (page_count between 1 and 100000),
  current_page integer check (current_page between 0 and 100000),
  progress_percent numeric(5, 2) check (progress_percent between 0 and 100),
  publisher text check (private.lib_line_ok(publisher, 200)),
  published_year integer check (published_year between -3000 and 3000),
  -- Episode only. D59: an episode may have no show.
  show_id uuid,
  platform text check (platform in ('spotify', 'apple', 'youtube', 'ivoox', 'web', 'other')),
  duration_seconds integer check (duration_seconds between 1 and 86400),
  published_on date,
  episode_number integer check (episode_number between 0 and 1000000),
  position_seconds integer check (position_seconds between 0 and 86400),
  field_seqs jsonb not null default '{}'::jsonb check (jsonb_typeof(field_seqs) = 'object'),
  field_stamps jsonb not null default '{}'::jsonb check (jsonb_typeof(field_stamps) = 'object'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null default nextval('public.change_seq'),
  unique (id, user_id),
  -- The show belongs to the same user (composite key).
  foreign key (show_id, user_id) references public.podcast_shows (id, user_id),
  constraint items_live_title check (deleted_at is not null or private.lib_line_ok(title, 300)),
  constraint items_dates check (started_on is null or finished_on is null or started_on <= finished_on),
  -- Each format only carries its own fields.
  constraint items_book_fields check (kind = 'book' or (isbn13 is null and isbn10 is null and page_count is null
    and current_page is null and progress_percent is null and publisher is null and published_year is null)),
  constraint items_episode_fields check (kind = 'episode' or (show_id is null and platform is null and duration_seconds is null
    and published_on is null and episode_number is null and position_seconds is null)),
  constraint items_progress check ((page_count is null or current_page is null or current_page <= page_count)
    and (duration_seconds is null or position_seconds is null or position_seconds <= duration_seconds)),
  constraint items_cover check ((cover_source is null) = (cover_ref is null)
    and (cover_source is distinct from 'external' or private.lib_url_ok(cover_ref))
    and (cover_source is distinct from 'upload' or char_length(cover_ref) between 1 and 500)),
  constraint items_external check ((external_provider is null) = (external_id is null)
    and (external_attribution is null or external_provider is not null))
);
create index library_items_user_seq on public.library_items (user_id, server_seq);
create index library_items_show on public.library_items (show_id) where show_id is not null;
-- PRD §4.1: one record per external id and user (another edition has another id).
create unique index library_items_external on public.library_items (user_id, kind, external_provider, external_id)
  where external_id is not null and deleted_at is null;

create table public.knowledge_notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- null: a free-standing idea (D62).
  item_id uuid,
  note_type text not null check (note_type in ('idea', 'learning', 'quote', 'application', 'note', 'question')),
  -- D63: plain text today; a richer format would come with its own column, body staying plain.
  format text not null default 'plain' check (format = 'plain'),
  body text not null check (char_length(body) <= 10000),
  page integer check (page between 0 and 100000),
  position_seconds integer check (position_seconds between 0 and 86400),
  locator_label text check (private.lib_line_ok(locator_label, 120)),
  starred boolean not null default false,
  application_status text check (application_status in ('open', 'doing', 'done', 'dropped')),
  application_habit_id uuid,
  application_goal_id uuid,
  application_link_title text check (private.lib_line_ok(application_link_title, 200)),
  topics text[] not null default '{}' check (private.lib_list_ok(topics, 10, 40)),
  -- When the user wrote it (client clock, clamped): offline captures keep their real moment.
  captured_at timestamptz not null default now(),
  field_seqs jsonb not null default '{}'::jsonb check (jsonb_typeof(field_seqs) = 'object'),
  field_stamps jsonb not null default '{}'::jsonb check (jsonb_typeof(field_stamps) = 'object'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null default nextval('public.change_seq'),
  unique (id, user_id),
  foreign key (item_id, user_id) references public.library_items (id, user_id),
  foreign key (application_habit_id, user_id) references public.habits (id, user_id),
  foreign key (application_goal_id, user_id) references public.goals (id, user_id),
  constraint notes_live_body check (deleted_at is not null or (private.lib_block_ok(body, 10000)
    and (note_type <> 'quote' or char_length(body) <= 2000))),
  -- Status only (and always) for applications; the link only on applications, to one target.
  constraint notes_application check (deleted_at is not null or ((note_type = 'application') = (application_status is not null))),
  constraint notes_application_link check ((application_habit_id is null or application_goal_id is null)
    and ((application_habit_id is null and application_goal_id is null) = (application_link_title is null))
    and (application_link_title is null or note_type = 'application')),
  constraint notes_free_locator check (item_id is not null or (page is null and position_seconds is null and locator_label is null))
);
create index knowledge_notes_user_seq on public.knowledge_notes (user_id, server_seq);
create index knowledge_notes_item on public.knowledge_notes (user_id, item_id);

create table public.knowledge_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  a_type text not null check (a_type in ('item', 'show', 'note')),
  a_id uuid not null,
  b_type text not null check (b_type in ('item', 'show', 'note')),
  b_id uuid not null,
  origin text not null default 'manual' check (origin = 'manual'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  server_seq bigint not null default nextval('public.change_seq'),
  -- One row per unordered pair, stored in canonical order (relations.ts canonicalLink).
  constraint links_canonical check ((a_type || ':' || a_id::text) < (b_type || ':' || b_id::text)),
  constraint links_one_per_pair unique (user_id, a_type, a_id, b_type, b_id)
);
create index knowledge_links_user_seq on public.knowledge_links (user_id, server_seq);

-- ── Guard: write path, identity, cross-row rules, tombstones, versions ─────────
create or replace function private.lib_entity_live(p_uid uuid, p_type text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_type
    when 'item' then exists (select 1 from public.library_items i where i.id = p_id and i.user_id = p_uid and i.deleted_at is null)
    when 'show' then exists (select 1 from public.podcast_shows s where s.id = p_id and s.user_id = p_uid and s.deleted_at is null)
    when 'note' then exists (select 1 from public.knowledge_notes n where n.id = p_id and n.user_id = p_uid and n.deleted_at is null)
    else false end
$$;

create or replace function private.guard_library()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_new jsonb;
  v_old jsonb := '{}'::jsonb;
  v_seqs jsonb := '{}'::jsonb;
  v_key text;
  v_item public.library_items;
begin
  -- Only private.apply_library_op writes the library (transaction-local flag): no direct API writes.
  if coalesce(current_setting('top.library_op', true), '') <> 'on' then
    raise exception 'library_via_ops_only' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.id <> old.id or new.user_id <> old.user_id or new.created_at <> old.created_at) then
    raise exception 'immutable_identity' using errcode = 'P0001';
  end if;
  -- Nested on purpose: a condition naming a column must only run on the table that has it.
  if tg_op = 'UPDATE' then
    if tg_table_name = 'library_items' then
      if new.kind <> old.kind then
        raise exception 'immutable_identity' using errcode = 'P0001';
      end if;
    elsif tg_table_name = 'knowledge_links' then
      if (new.a_type, new.a_id, new.b_type, new.b_id) is distinct from (old.a_type, old.a_id, old.b_type, old.b_id) then
        raise exception 'immutable_identity' using errcode = 'P0001';
      end if;
    end if;
  end if;

  new.server_seq := nextval('public.change_seq');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.version := old.version + 1;
  end if;

  if new.deleted_at is not null then
    -- A tombstone keeps no personal text (privacy); restoring sends the content again.
    if tg_table_name = 'library_items' then
      new := jsonb_populate_record(new, jsonb_build_object(
        'title', '', 'subtitle', null, 'creators', '{}'::text[], 'description', null, 'topics', '{}'::text[], 'language', null,
        'favorite', false, 'rating', null, 'started_on', null, 'finished_on', null, 'cover_source', null, 'cover_ref', null,
        'source_url', null, 'external_provider', null, 'external_id', null, 'external_attribution', null,
        'isbn13', null, 'isbn10', null, 'page_count', null, 'current_page', null, 'progress_percent', null, 'publisher', null,
        'published_year', null, 'show_id', null, 'platform', null, 'duration_seconds', null, 'published_on', null,
        'episode_number', null, 'position_seconds', null, 'field_seqs', '{}'::jsonb, 'field_stamps', '{}'::jsonb));
    elsif tg_table_name = 'podcast_shows' then
      new := jsonb_populate_record(new, jsonb_build_object(
        'title', '', 'publisher', null, 'description', null, 'topics', '{}'::text[], 'cover_source', null, 'cover_ref', null,
        'source_url', null, 'external_provider', null, 'external_id', null, 'external_attribution', null,
        'field_seqs', '{}'::jsonb, 'field_stamps', '{}'::jsonb));
    elsif tg_table_name = 'knowledge_notes' then
      new := jsonb_populate_record(new, jsonb_build_object(
        'body', '', 'page', null, 'position_seconds', null, 'locator_label', null, 'starred', false,
        'application_status', null, 'application_habit_id', null, 'application_goal_id', null,
        'application_link_title', null, 'topics', '{}'::text[], 'field_seqs', '{}'::jsonb, 'field_stamps', '{}'::jsonb));
    end if;
    return new;
  end if;

  -- Cross-row rules of live rows (the ones a CHECK cannot express).
  if tg_table_name = 'library_items' then
    if new.show_id is not null and not private.lib_entity_live(new.user_id, 'show', new.show_id) then
      raise exception 'show_not_found' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'knowledge_notes' then
    if new.item_id is not null then
      select * into v_item from public.library_items i where i.id = new.item_id and i.user_id = new.user_id;
      if not found or v_item.deleted_at is not null then
        raise exception 'item_not_found' using errcode = 'P0001';
      end if;
      -- A page belongs to a book, a timestamp to an episode, both within the content.
      if new.page is not null and (v_item.kind <> 'book' or (v_item.page_count is not null and new.page > v_item.page_count)) then
        raise exception 'invalid_locator' using errcode = 'P0001';
      end if;
      if new.position_seconds is not null and (v_item.kind <> 'episode'
         or (v_item.duration_seconds is not null and new.position_seconds > v_item.duration_seconds)) then
        raise exception 'invalid_locator' using errcode = 'P0001';
      end if;
    end if;
  elsif tg_table_name = 'knowledge_links' then
    if not private.lib_entity_live(new.user_id, new.a_type, new.a_id) or not private.lib_entity_live(new.user_id, new.b_type, new.b_id) then
      raise exception 'link_target_not_found' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- Per-field versions: the server_seq of the last change of each field (D68 conflict base).
  -- A live row keeps them; a restored tombstone starts again.
  if tg_op = 'UPDATE' and old.deleted_at is null then
    v_old := to_jsonb(old);
    v_seqs := old.field_seqs;
  end if;
  v_new := to_jsonb(new);
  for v_key in select jsonb_object_keys(v_new) loop
    if v_key in ('id', 'user_id', 'kind', 'format', 'field_seqs', 'field_stamps', 'version', 'created_at', 'updated_at',
                 'deleted_at', 'server_seq') then
      continue;
    end if;
    if (v_new -> v_key) is distinct from coalesce(v_old -> v_key, 'null'::jsonb) then
      v_seqs := jsonb_set(v_seqs, array[v_key], to_jsonb(new.server_seq));
    end if;
  end loop;
  new.field_seqs := v_seqs;
  return new;
end;
$$;
create trigger podcast_shows_guard before insert or update on public.podcast_shows
  for each row execute function private.guard_library();
create trigger library_items_guard before insert or update on public.library_items
  for each row execute function private.guard_library();
create trigger knowledge_notes_guard before insert or update on public.knowledge_notes
  for each row execute function private.guard_library();
create trigger knowledge_links_guard before insert or update on public.knowledge_links
  for each row execute function private.guard_library();

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.podcast_shows enable row level security;
alter table public.library_items enable row level security;
alter table public.knowledge_notes enable row level security;
alter table public.knowledge_links enable row level security;

create policy "podcast_shows: read own" on public.podcast_shows for select to authenticated using (user_id = (select auth.uid()));
create policy "podcast_shows: insert own" on public.podcast_shows for insert to authenticated with check (user_id = (select auth.uid()));
create policy "podcast_shows: update own" on public.podcast_shows for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "library_items: read own" on public.library_items for select to authenticated using (user_id = (select auth.uid()));
create policy "library_items: insert own" on public.library_items for insert to authenticated with check (user_id = (select auth.uid()));
create policy "library_items: update own" on public.library_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "knowledge_notes: read own" on public.knowledge_notes for select to authenticated using (user_id = (select auth.uid()));
create policy "knowledge_notes: insert own" on public.knowledge_notes for insert to authenticated with check (user_id = (select auth.uid()));
create policy "knowledge_notes: update own" on public.knowledge_notes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "knowledge_links: read own" on public.knowledge_links for select to authenticated using (user_id = (select auth.uid()));
create policy "knowledge_links: insert own" on public.knowledge_links for insert to authenticated with check (user_id = (select auth.uid()));
create policy "knowledge_links: update own" on public.knowledge_links for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.podcast_shows, public.library_items, public.knowledge_notes, public.knowledge_links from anon;
revoke delete, truncate on public.podcast_shows, public.library_items, public.knowledge_notes, public.knowledge_links from authenticated;

alter publication supabase_realtime add table public.podcast_shows, public.library_items, public.knowledge_notes, public.knowledge_links;

-- ── Operations ───────────────────────────────────────────────────────────
-- Serializes the library writes of one user (and lets pull_library wait for them): see the header.
create or replace function private.lib_lock_key(p_uid uuid)
returns bigint
language sql
immutable
set search_path = ''
as $$ select hashtextextended('top.library:' || p_uid::text, 0) $$;

-- Editable fields per entity (wire names = column names). Anything else in `fields` is rejected.
create or replace function private.lib_fields(p_table text, p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'show' then array['title', 'publisher', 'description', 'topics', 'cover_source', 'cover_ref', 'source_url',
                           'external_provider', 'external_id', 'external_attribution']
    when 'item' then array['title', 'subtitle', 'creators', 'description', 'topics', 'language', 'status', 'favorite', 'rating',
                           'started_on', 'finished_on', 'cover_source', 'cover_ref', 'source_url', 'external_provider',
                           'external_id', 'external_attribution']
      || case p_kind
           when 'book' then array['isbn13', 'isbn10', 'page_count', 'current_page', 'progress_percent', 'publisher', 'published_year']
           when 'episode' then array['show_id', 'platform', 'duration_seconds', 'published_on', 'episode_number', 'position_seconds']
           else array[]::text[] end
    when 'note' then array['item_id', 'note_type', 'body', 'page', 'position_seconds', 'locator_label', 'starred',
                           'application_status', 'application_habit_id', 'application_goal_id', 'application_link_title', 'topics']
    else array[]::text[] end
$$;

-- D68: long texts never resolve by clock; concurrent edits keep both versions (conflict).
create or replace function private.lib_protected(p_table text)
returns text[]
language sql
immutable
set search_path = ''
as $$ select case p_table when 'note' then array['body'] else array['description'] end $$;

-- Client stamp of a write (hybrid clock), limited to «now + 1 min» like the other modules.
create or replace function private.lib_stamp(p_op jsonb)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_op -> 'at') is distinct from 'string' or not pg_input_is_valid(p_op ->> 'at', 'timestamptz') then
    raise exception 'invalid_stamp' using errcode = 'P0001';
  end if;
  return least((p_op ->> 'at')::timestamptz, now() + interval '1 minute');
end;
$$;

create or replace function private.lib_check_fields(p_fields jsonb, p_allowed text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_fields) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_fields) k where not (k = any (p_allowed))) then
    raise exception 'invalid_fields' using errcode = 'P0001';
  end if;
end;
$$;

-- Stamps of every field of a write.
create or replace function private.lib_stamps(p_fields jsonb, p_at timestamptz)
returns jsonb
language sql
immutable
set search_path = ''
as $$ select coalesce(jsonb_object_agg(k, to_jsonb(p_at)), '{}'::jsonb) from jsonb_object_keys(p_fields) k $$;

/*
 * Field-level merge of an update (D68), shared by the three editable entities:
 * - a field nobody changed since the edit's base (or never set) is applied;
 * - a concurrent change to the same value is a no-op;
 * - a concurrent change to a protected text is a conflict: nothing is written (all or nothing,
 *   like reviews) and the conflicting field names go back to the client, which keeps its text;
 * - a concurrent change to any other field is decided by the client stamp (newest wins);
 *   older stamps are reported as `stale`.
 */
create or replace function private.lib_merge(p_current jsonb, p_fields jsonb, p_bases jsonb, p_at timestamptz, p_protected text[],
                                             out applied jsonb, out conflicts text[], out stale text[])
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
  v_cur_seq bigint;
  v_base jsonb;
begin
  applied := '{}'::jsonb;
  conflicts := '{}'::text[];
  stale := '{}'::text[];
  for v_key, v_val in select k, v from jsonb_each(p_fields) as t(k, v) loop
    v_cur_seq := (p_current -> 'field_seqs' ->> v_key)::bigint;
    v_base := p_bases -> v_key;
    if v_cur_seq is null or (jsonb_typeof(v_base) = 'number' and (v_base #>> '{}')::bigint = v_cur_seq) then
      applied := applied || jsonb_build_object(v_key, v_val);
    elsif coalesce(p_current -> v_key, 'null'::jsonb) = v_val then
      continue;
    elsif v_key = any (p_protected) then
      conflicts := conflicts || v_key;
    elsif p_at > coalesce((p_current -> 'field_stamps' ->> v_key)::timestamptz, '-infinity'::timestamptz) then
      applied := applied || jsonb_build_object(v_key, v_val);
    else
      stale := stale || v_key;
    end if;
  end loop;
end;
$$;

-- The row of each entity as the client sees it (pull_library and conflict answers): without the
-- owner, without the per-field stamps (only the server resolves with them) and without null columns
-- (a missing key means null). Measured in M4b with 5.000 notes: 43 % less uncompressed JSON.
create or replace function private.lib_row_json(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$ select jsonb_strip_nulls(p_row - 'user_id' - 'field_stamps') || jsonb_build_object('deleted', p_row -> 'deleted_at' <> 'null'::jsonb) $$;

create or replace function private.library_op(p_uid uuid, p_type text, p_op jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_entity text := split_part(p_type, '.', 2);
  v_action text := split_part(p_type, '.', 3);
  v_id uuid;
  v_fields jsonb := coalesce(p_op -> 'fields', '{}'::jsonb);
  v_at timestamptz;
  v_kind text;
  v_cur jsonb;
  v_m record;
  v_seq bigint;
  v_item public.library_items;
  v_show public.podcast_shows;
  v_note public.knowledge_notes;
  v_a_type text;
  v_a_id uuid;
  v_b_type text;
  v_b_id uuid;
  v_constraint text;
begin
  perform pg_advisory_xact_lock(private.lib_lock_key(p_uid));

  -- ── links: desired state (D6), canonical pair ──
  if p_type = 'library.link.set' then
    if jsonb_typeof(p_op -> 'linked') is distinct from 'boolean' then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
    if (p_op ->> 'a_type') || ':' || (p_op ->> 'a_id') < (p_op ->> 'b_type') || ':' || (p_op ->> 'b_id') then
      v_a_type := p_op ->> 'a_type'; v_a_id := (p_op ->> 'a_id')::uuid; v_b_type := p_op ->> 'b_type'; v_b_id := (p_op ->> 'b_id')::uuid;
    else
      v_a_type := p_op ->> 'b_type'; v_a_id := (p_op ->> 'b_id')::uuid; v_b_type := p_op ->> 'a_type'; v_b_id := (p_op ->> 'a_id')::uuid;
    end if;
    if v_a_type is null or v_b_type is null or v_a_id is null or v_b_id is null or (v_a_type = v_b_type and v_a_id = v_b_id) then
      raise exception 'invalid_link' using errcode = 'P0001';
    end if;
    if (p_op -> 'linked')::boolean then
      insert into public.knowledge_links (user_id, a_type, a_id, b_type, b_id)
        values (p_uid, v_a_type, v_a_id, v_b_type, v_b_id)
        on conflict (user_id, a_type, a_id, b_type, b_id) do update set deleted_at = null
        where public.knowledge_links.deleted_at is not null;
    else
      update public.knowledge_links l set deleted_at = now()
        where l.user_id = p_uid and l.a_type = v_a_type and l.a_id = v_a_id and l.b_type = v_b_type and l.b_id = v_b_id
          and l.deleted_at is null;
    end if;
    return jsonb_build_object('outcome', 'applied');
  end if;

  if v_entity not in ('show', 'item', 'note') or v_action not in ('create', 'update', 'delete', 'restore') then
    raise exception 'unknown_op_type' using errcode = 'P0001';
  end if;
  v_id := (p_op ->> 'id')::uuid;
  if v_id is null then
    raise exception 'invalid_value' using errcode = 'P0001';
  end if;

  -- Current row (locked), whoever owns it: another user's id is never readable or writable.
  if v_entity = 'show' then
    select to_jsonb(s) into v_cur from public.podcast_shows s where s.id = v_id for update;
  elsif v_entity = 'item' then
    select to_jsonb(i) into v_cur from public.library_items i where i.id = v_id for update;
  else
    select to_jsonb(n) into v_cur from public.knowledge_notes n where n.id = v_id for update;
  end if;
  if v_cur is not null and (v_cur ->> 'user_id')::uuid is distinct from p_uid then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- ── create / restore: the whole entity; never over a live row, never reviving by accident ──
  if v_action in ('create', 'restore') then
    v_at := private.lib_stamp(p_op);
    v_kind := case when v_entity = 'item' then coalesce(p_op ->> 'kind', v_cur ->> 'kind') end;
    if v_entity = 'item' and v_kind not in ('book', 'episode') then
      raise exception 'invalid_value' using errcode = 'P0001';
    end if;
    perform private.lib_check_fields(v_fields, private.lib_fields(v_entity, v_kind));
    if v_cur is not null and v_cur -> 'deleted_at' = 'null'::jsonb then
      -- Same id already live: a replay under another op id, or a restore that is not needed.
      return jsonb_build_object('outcome', 'superseded', 'code', 'exists', 'seq', (v_cur ->> 'server_seq')::bigint);
    end if;
    if v_cur is not null and v_action = 'create' then
      -- A late create of something deleted since: only an explicit restore brings it back.
      return jsonb_build_object('outcome', 'conflict', 'code', 'deleted');
    end if;
    if v_cur is null and v_action = 'restore' then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    if v_entity = 'item' and v_cur is not null and v_cur ->> 'kind' <> v_kind then
      raise exception 'immutable_identity' using errcode = 'P0001';
    end if;
    -- A note can only be written on a live content (else the client keeps the text, D68).
    if v_entity = 'note' and v_fields ->> 'item_id' is not null
       and not private.lib_entity_live(p_uid, 'item', (v_fields ->> 'item_id')::uuid) then
      return jsonb_build_object('outcome', 'conflict', 'code', 'item_deleted');
    end if;

    if v_entity = 'show' then
      v_show := jsonb_populate_record(null::public.podcast_shows, jsonb_build_object(
        'id', v_id, 'user_id', p_uid, 'title', '', 'topics', '{}'::text[], 'field_seqs', '{}'::jsonb, 'version', 1,
        'created_at', coalesce(v_cur -> 'created_at', to_jsonb(now())), 'updated_at', now()) || v_fields
        || jsonb_build_object('field_stamps', private.lib_stamps(v_fields, v_at)));
      if v_cur is null then
        begin
          insert into public.podcast_shows select (v_show).*;
        exception when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          -- An id taken by another user answers exactly like one that does not exist.
          raise exception '%', case when v_constraint like '%_pkey' then 'not_found' else 'duplicate_external' end using errcode = 'P0001';
        end;
      else
        update public.podcast_shows s set (title, publisher, description, topics, cover_source, cover_ref, source_url,
          external_provider, external_id, external_attribution, field_stamps, deleted_at)
          = (v_show.title, v_show.publisher, v_show.description, v_show.topics, v_show.cover_source, v_show.cover_ref,
             v_show.source_url, v_show.external_provider, v_show.external_id, v_show.external_attribution, v_show.field_stamps, null)
          where s.id = v_id;
      end if;
      select s.server_seq into v_seq from public.podcast_shows s where s.id = v_id;
    elsif v_entity = 'item' then
      v_item := jsonb_populate_record(null::public.library_items, jsonb_build_object(
        'id', v_id, 'user_id', p_uid, 'kind', v_kind, 'title', '', 'creators', '{}'::text[], 'topics', '{}'::text[],
        'status', 'planned', 'favorite', false, 'field_seqs', '{}'::jsonb, 'version', 1,
        'created_at', coalesce(v_cur -> 'created_at', to_jsonb(now())), 'updated_at', now()) || v_fields
        || jsonb_build_object('field_stamps', private.lib_stamps(v_fields, v_at)));
      if v_cur is null then
        begin
          insert into public.library_items select (v_item).*;
        exception when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          -- An id taken by another user answers exactly like one that does not exist.
          raise exception '%', case when v_constraint like '%_pkey' then 'not_found' else 'duplicate_external' end using errcode = 'P0001';
        end;
      else
        update public.library_items i set (title, subtitle, creators, description, topics, language, status, favorite, rating,
          started_on, finished_on, cover_source, cover_ref, source_url, external_provider, external_id, external_attribution,
          isbn13, isbn10, page_count, current_page, progress_percent, publisher, published_year,
          show_id, platform, duration_seconds, published_on, episode_number, position_seconds, field_stamps, deleted_at)
          = (v_item.title, v_item.subtitle, v_item.creators, v_item.description, v_item.topics, v_item.language, v_item.status,
             v_item.favorite, v_item.rating, v_item.started_on, v_item.finished_on, v_item.cover_source, v_item.cover_ref,
             v_item.source_url, v_item.external_provider, v_item.external_id, v_item.external_attribution,
             v_item.isbn13, v_item.isbn10, v_item.page_count, v_item.current_page, v_item.progress_percent, v_item.publisher,
             v_item.published_year, v_item.show_id, v_item.platform, v_item.duration_seconds, v_item.published_on,
             v_item.episode_number, v_item.position_seconds, v_item.field_stamps, null)
          where i.id = v_id;
      end if;
      select i.server_seq into v_seq from public.library_items i where i.id = v_id;
    else
      v_note := jsonb_populate_record(null::public.knowledge_notes, jsonb_build_object(
        'id', v_id, 'user_id', p_uid, 'body', '', 'format', 'plain', 'starred', false, 'topics', '{}'::text[],
        'captured_at', least(coalesce(nullif(p_op ->> 'captured_at', '')::timestamptz, now()), now() + interval '1 minute'),
        'field_seqs', '{}'::jsonb, 'version', 1,
        'created_at', coalesce(v_cur -> 'created_at', to_jsonb(now())), 'updated_at', now()) || v_fields
        || jsonb_build_object('field_stamps', private.lib_stamps(v_fields, v_at)));
      if v_cur is null then
        begin
          insert into public.knowledge_notes select (v_note).*;
        exception when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          -- An id taken by another user answers exactly like one that does not exist.
          raise exception '%', case when v_constraint like '%_pkey' then 'not_found' else 'duplicate_external' end using errcode = 'P0001';
        end;
      else
        update public.knowledge_notes n set (item_id, note_type, body, page, position_seconds, locator_label, starred,
          application_status, application_habit_id, application_goal_id, application_link_title, topics, captured_at,
          field_stamps, deleted_at)
          = (v_note.item_id, v_note.note_type, v_note.body, v_note.page, v_note.position_seconds, v_note.locator_label,
             v_note.starred, v_note.application_status, v_note.application_habit_id, v_note.application_goal_id,
             v_note.application_link_title, v_note.topics, v_note.captured_at, v_note.field_stamps, null)
          where n.id = v_id;
      end if;
      select n.server_seq into v_seq from public.knowledge_notes n where n.id = v_id;
    end if;
    perform private.audit(p_uid, 'library_' || v_entity, v_id, v_action,
      case when v_entity = 'item' then jsonb_build_object('kind', v_kind) else '{}'::jsonb end);
    return jsonb_build_object('outcome', 'applied', 'seq', v_seq);
  end if;

  if v_cur is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- ── delete: only the version the user saw; never removes work they have not seen ──
  if v_action = 'delete' then
    if v_cur -> 'deleted_at' <> 'null'::jsonb then
      return jsonb_build_object('outcome', 'applied');
    end if;
    if jsonb_typeof(p_op -> 'base_seq') is distinct from 'number' or (p_op ->> 'base_seq')::bigint <> (v_cur ->> 'server_seq')::bigint then
      return jsonb_build_object('outcome', 'conflict', 'code', 'changed');
    end if;
    if v_entity = 'item' then
      -- Its notes go with it: refused if any changed or was added after what the user saw.
      if exists (select 1 from public.knowledge_notes n where n.user_id = p_uid and n.item_id = v_id and n.deleted_at is null
                   and n.server_seq > coalesce((p_op ->> 'notes_seq')::bigint, 0)) then
        return jsonb_build_object('outcome', 'conflict', 'code', 'notes_changed');
      end if;
      update public.knowledge_links l set deleted_at = now()
        where l.user_id = p_uid and l.deleted_at is null
          and ((l.a_type = 'item' and l.a_id = v_id) or (l.b_type = 'item' and l.b_id = v_id)
               or (l.a_type = 'note' and l.a_id in (select n.id from public.knowledge_notes n where n.user_id = p_uid and n.item_id = v_id))
               or (l.b_type = 'note' and l.b_id in (select n.id from public.knowledge_notes n where n.user_id = p_uid and n.item_id = v_id)));
      update public.knowledge_notes n set deleted_at = now() where n.user_id = p_uid and n.item_id = v_id and n.deleted_at is null;
      update public.library_items i set deleted_at = now() where i.id = v_id;
    elsif v_entity = 'show' then
      -- Deleting a show never deletes knowledge: its episodes stay, without a show.
      update public.library_items i set show_id = null where i.user_id = p_uid and i.show_id = v_id;
      update public.knowledge_links l set deleted_at = now()
        where l.user_id = p_uid and l.deleted_at is null
          and ((l.a_type = 'show' and l.a_id = v_id) or (l.b_type = 'show' and l.b_id = v_id));
      update public.podcast_shows s set deleted_at = now() where s.id = v_id;
    else
      update public.knowledge_links l set deleted_at = now()
        where l.user_id = p_uid and l.deleted_at is null
          and ((l.a_type = 'note' and l.a_id = v_id) or (l.b_type = 'note' and l.b_id = v_id));
      update public.knowledge_notes n set deleted_at = now() where n.id = v_id;
    end if;
    perform private.audit(p_uid, 'library_' || v_entity, v_id, 'delete', '{}'::jsonb);
    return jsonb_build_object('outcome', 'applied');
  end if;

  -- ── update: field by field (D68) ──
  v_at := private.lib_stamp(p_op);
  perform private.lib_check_fields(v_fields, private.lib_fields(v_entity, v_cur ->> 'kind'));
  if v_fields = '{}'::jsonb or jsonb_typeof(coalesce(p_op -> 'base_seqs', '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_fields' using errcode = 'P0001';
  end if;
  -- A late edit of something deleted since does not bring it back (the client keeps its text).
  if v_cur -> 'deleted_at' <> 'null'::jsonb then
    return jsonb_build_object('outcome', 'conflict', 'code', 'deleted');
  end if;
  select * into v_m from private.lib_merge(v_cur, v_fields, coalesce(p_op -> 'base_seqs', '{}'::jsonb), v_at, private.lib_protected(v_entity));
  if cardinality(v_m.conflicts) > 0 then
    return jsonb_build_object('outcome', 'conflict', 'code', 'field_conflict', 'fields', to_jsonb(v_m.conflicts),
                              'current', private.lib_row_json(v_cur));
  end if;
  if v_m.applied = '{}'::jsonb then
    return jsonb_build_object('outcome', case when cardinality(v_m.stale) > 0 then 'superseded' else 'applied' end,
                              'code', case when cardinality(v_m.stale) > 0 then 'stale_fields' end,
                              'seq', (v_cur ->> 'server_seq')::bigint);
  end if;
  -- A note moved to another content: the target must be live (else the client keeps the text).
  if v_entity = 'note' and v_m.applied ? 'item_id' and v_m.applied ->> 'item_id' is not null
     and not private.lib_entity_live(p_uid, 'item', (v_m.applied ->> 'item_id')::uuid) then
    return jsonb_build_object('outcome', 'conflict', 'code', 'item_deleted');
  end if;

  if v_entity = 'show' then
    v_show := jsonb_populate_record(jsonb_populate_record(null::public.podcast_shows, v_cur), v_m.applied);
    update public.podcast_shows s set (title, publisher, description, topics, cover_source, cover_ref, source_url,
      external_provider, external_id, external_attribution, field_stamps)
      = (v_show.title, v_show.publisher, v_show.description, v_show.topics, v_show.cover_source, v_show.cover_ref,
         v_show.source_url, v_show.external_provider, v_show.external_id, v_show.external_attribution,
         s.field_stamps || private.lib_stamps(v_m.applied, v_at))
      where s.id = v_id
      returning s.server_seq into v_seq;
  elsif v_entity = 'item' then
    v_item := jsonb_populate_record(jsonb_populate_record(null::public.library_items, v_cur), v_m.applied);
    update public.library_items i set (title, subtitle, creators, description, topics, language, status, favorite, rating,
      started_on, finished_on, cover_source, cover_ref, source_url, external_provider, external_id, external_attribution,
      isbn13, isbn10, page_count, current_page, progress_percent, publisher, published_year,
      show_id, platform, duration_seconds, published_on, episode_number, position_seconds, field_stamps)
      = (v_item.title, v_item.subtitle, v_item.creators, v_item.description, v_item.topics, v_item.language, v_item.status,
         v_item.favorite, v_item.rating, v_item.started_on, v_item.finished_on, v_item.cover_source, v_item.cover_ref,
         v_item.source_url, v_item.external_provider, v_item.external_id, v_item.external_attribution,
         v_item.isbn13, v_item.isbn10, v_item.page_count, v_item.current_page, v_item.progress_percent, v_item.publisher,
         v_item.published_year, v_item.show_id, v_item.platform, v_item.duration_seconds, v_item.published_on,
         v_item.episode_number, v_item.position_seconds, i.field_stamps || private.lib_stamps(v_m.applied, v_at))
      where i.id = v_id
      returning i.server_seq into v_seq;
    if v_m.applied ? 'status' then
      perform private.audit(p_uid, 'library_item', v_id, 'status', jsonb_build_object('status', v_m.applied ->> 'status'));
    end if;
  else
    v_note := jsonb_populate_record(jsonb_populate_record(null::public.knowledge_notes, v_cur), v_m.applied);
    update public.knowledge_notes n set (item_id, note_type, body, page, position_seconds, locator_label, starred,
      application_status, application_habit_id, application_goal_id, application_link_title, topics, field_stamps)
      = (v_note.item_id, v_note.note_type, v_note.body, v_note.page, v_note.position_seconds, v_note.locator_label,
         v_note.starred, v_note.application_status, v_note.application_habit_id, v_note.application_goal_id,
         v_note.application_link_title, v_note.topics, n.field_stamps || private.lib_stamps(v_m.applied, v_at))
      where n.id = v_id
      returning n.server_seq into v_seq;
  end if;
  return jsonb_build_object('outcome', 'applied', 'seq', v_seq)
    || case when cardinality(v_m.stale) > 0 then jsonb_build_object('stale', to_jsonb(v_m.stale)) else '{}'::jsonb end;
end;
$$;

-- Sets the write flag for this transaction, runs the operation and clears it. If the operation
-- raises, apply_ops rolls its subtransaction back, flag included.
create or replace function private.apply_library_op(p_uid uuid, p_type text, p_op jsonb)
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
  perform set_config('top.library_op', 'on', true);
  v_result := private.library_op(p_uid, p_type, p_op);
  perform set_config('top.library_op', '', true);
  return v_result;
end;
$$;

-- ── pull_library (N2): paged, ordered by server_seq, tombstones included ──
-- Returns the changes after `p_since`, at most `p_limit` (1..1000), in server_seq order across the
-- four tables. A rebuild (no local copy: p_since = 0, or p_full on every page of it) leaves
-- tombstones out. The client applies a page, persists it, and only then uses `cursor` for the
-- next call; `has_more` says whether to continue. `head` is the newest library change of the user.
create or replace function public.pull_library(p_since bigint default 0, p_limit integer default 500, p_full boolean default false)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_since bigint := greatest(coalesce(p_since, 0), 0);
  v_full boolean := coalesce(p_since, 0) <= 0 or coalesce(p_full, false);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_rows jsonb;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- Waits for this user's library writes in flight (see the header): no change can commit later
  -- with a server_seq below what this page returns.
  perform pg_advisory_xact_lock_shared(private.lib_lock_key(v_uid));

  select coalesce(jsonb_agg(jsonb_build_object('t', c.t, 'seq', c.seq, 'row', c.row) order by c.seq), '[]'::jsonb), count(*)
    into v_rows, v_count
  from (
    select u.t, u.seq, u.row from (
      select 'show' as t, s.server_seq as seq, private.lib_row_json(to_jsonb(s)) as row
        from public.podcast_shows s where s.user_id = v_uid and s.server_seq > v_since and (not v_full or s.deleted_at is null)
      union all
      select 'item', i.server_seq, private.lib_row_json(to_jsonb(i))
        from public.library_items i where i.user_id = v_uid and i.server_seq > v_since and (not v_full or i.deleted_at is null)
      union all
      select 'note', n.server_seq, private.lib_row_json(to_jsonb(n))
        from public.knowledge_notes n where n.user_id = v_uid and n.server_seq > v_since and (not v_full or n.deleted_at is null)
      union all
      select 'link', l.server_seq, private.lib_row_json(to_jsonb(l))
        from public.knowledge_links l where l.user_id = v_uid and l.server_seq > v_since and (not v_full or l.deleted_at is null)
    ) u
    order by u.seq
    limit v_limit + 1
  ) c;

  if v_count > v_limit then
    v_rows := v_rows - v_limit;
  end if;
  return jsonb_build_object(
    'changes', v_rows,
    'cursor', coalesce((v_rows -> -1 ->> 'seq')::bigint, v_since),
    'has_more', v_count > v_limit,
    'full', v_full,
    'head', private.lib_head(v_uid),
    'server_time', clock_timestamp());
end;
$$;

create or replace function private.lib_head(p_uid uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce((select max(s.server_seq) from public.podcast_shows s where s.user_id = p_uid), 0),
    coalesce((select max(i.server_seq) from public.library_items i where i.user_id = p_uid), 0),
    coalesce((select max(n.server_seq) from public.knowledge_notes n where n.user_id = p_uid), 0),
    coalesce((select max(l.server_seq) from public.knowledge_links l where l.user_id = p_uid), 0))
$$;

revoke all on function private.lib_norm(text) from public, anon;
revoke all on function private.lib_no_ctrl(text) from public, anon;
revoke all on function private.lib_line_ok(text, integer) from public, anon;
revoke all on function private.lib_block_ok(text, integer) from public, anon;
revoke all on function private.lib_list_ok(text[], integer, integer) from public, anon;
revoke all on function private.lib_url_ok(text) from public, anon;
revoke all on function private.lib_isbn13_ok(text) from public, anon;
revoke all on function private.lib_isbn10_ok(text) from public, anon;
revoke all on function private.lib_entity_live(uuid, text, uuid) from public, anon;
revoke all on function private.guard_library() from public, anon;
revoke all on function private.lib_lock_key(uuid) from public, anon;
revoke all on function private.lib_fields(text, text) from public, anon;
revoke all on function private.lib_protected(text) from public, anon;
revoke all on function private.lib_stamp(jsonb) from public, anon;
revoke all on function private.lib_check_fields(jsonb, text[]) from public, anon;
revoke all on function private.lib_stamps(jsonb, timestamptz) from public, anon;
revoke all on function private.lib_merge(jsonb, jsonb, jsonb, timestamptz, text[]) from public, anon;
revoke all on function private.lib_row_json(jsonb) from public, anon;
revoke all on function private.library_op(uuid, text, jsonb) from public, anon;
revoke all on function private.apply_library_op(uuid, text, jsonb) from public, anon;
revoke all on function private.lib_head(uuid) from public, anon;
revoke all on function public.pull_library(bigint, integer, boolean) from public, anon;
grant execute on function private.lib_norm(text) to authenticated;
grant execute on function private.lib_no_ctrl(text) to authenticated;
grant execute on function private.lib_line_ok(text, integer) to authenticated;
grant execute on function private.lib_block_ok(text, integer) to authenticated;
grant execute on function private.lib_list_ok(text[], integer, integer) to authenticated;
grant execute on function private.lib_url_ok(text) to authenticated;
grant execute on function private.lib_isbn13_ok(text) to authenticated;
grant execute on function private.lib_isbn10_ok(text) to authenticated;
grant execute on function private.lib_entity_live(uuid, text, uuid) to authenticated;
grant execute on function private.lib_lock_key(uuid) to authenticated;
grant execute on function private.lib_fields(text, text) to authenticated;
grant execute on function private.lib_protected(text) to authenticated;
grant execute on function private.lib_stamp(jsonb) to authenticated;
grant execute on function private.lib_check_fields(jsonb, text[]) to authenticated;
grant execute on function private.lib_stamps(jsonb, timestamptz) to authenticated;
grant execute on function private.lib_merge(jsonb, jsonb, jsonb, timestamptz, text[]) to authenticated;
grant execute on function private.lib_row_json(jsonb) to authenticated;
grant execute on function private.library_op(uuid, text, jsonb) to authenticated;
grant execute on function private.apply_library_op(uuid, text, jsonb) to authenticated;
grant execute on function private.lib_head(uuid) to authenticated;
grant execute on function public.pull_library(bigint, integer, boolean) to authenticated;

-- ── apply_ops: same ledger; library ops routed to apply_library_op; `seq` passed back ──
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

-- ── pull_changes: unchanged keys and cursor; + `library` (N2) ──
-- The library does not travel here (it would make every published client download it on each
-- pull): `library.head` announces that the account stores it and its newest change; the data
-- comes from pull_library with its own cursor.
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
