-- THE ONE PERCENT · M2 · 1/4 · Identity
-- Profiles, dimensions, private access allowlist and the global change feed sequence.

-- Private schema: never exposed through the Data API. Authenticated users get USAGE only so
-- constraint/trigger helpers resolve; private tables carry no grants.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Monotonic change feed used by pull-based sync. Every write bumps the row's server_seq.
create sequence if not exists public.change_seq;
grant usage on sequence public.change_seq to authenticated;

-- Shared trigger: maintain updated_at and server_seq on every write.
create or replace function private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_seq := nextval('public.change_seq');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Timezone validation (IANA names known to Postgres).
create or replace function private.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

-- Private V1: only allowlisted emails can create an account (no public onboarding, PRD §6).
create table private.allowed_emails (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  note text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'Europe/Madrid',
  locale text not null default 'es-ES',
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_seq bigint not null default nextval('public.change_seq'),
  constraint profiles_timezone_valid check (private.is_valid_timezone(timezone))
);

create table public.dimensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null check (slug in ('body', 'mind', 'learn', 'work')),
  name text not null check (char_length(name) between 1 and 40),
  sort_order smallint not null default 0,
  color text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, slug),
  unique (id, user_id)
);

create trigger profiles_touch before insert or update on public.profiles
  for each row execute function private.touch_row();

-- Today in the user's timezone: the single source of truth for date validation.
create or replace function public.user_today(p_user uuid default auth.uid())
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select p.timezone from public.profiles p where p.id = p_user),
    'Europe/Madrid'))::date;
$$;
revoke all on function public.user_today(uuid) from public, anon;
grant execute on function public.user_today(uuid) to authenticated;

-- New auth user: enforce allowlist, then create profile and the four V1 dimensions.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.allowed_emails a where a.email = lower(new.email)) then
    raise exception 'email_not_allowed' using errcode = 'P0001';
  end if;

  insert into public.profiles (id) values (new.id);
  insert into public.dimensions (user_id, slug, name, sort_order) values
    (new.id, 'body', 'Cuerpo', 1),
    (new.id, 'mind', 'Mente', 2),
    (new.id, 'learn', 'Aprendizaje', 3),
    (new.id, 'work', 'Trabajo profundo', 4);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.dimensions enable row level security;

create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "dimensions: read own" on public.dimensions
  for select to authenticated using (user_id = (select auth.uid()));

-- Least privilege: anon gets nothing on application tables; nobody but the owner sees the allowlist.
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on public.profiles, public.dimensions from anon;
revoke insert, delete on public.profiles from authenticated;
revoke insert, update, delete on public.dimensions from authenticated;
