-- THE ONE PERCENT · M2 · 4/4 · Realtime invalidation
-- Clients subscribe to their own changes (RLS applies to postgres_changes) and then pull.
alter publication supabase_realtime add table public.habits, public.habit_entries, public.routine_calendar, public.profiles;

-- Private helpers: no access for anon or PUBLIC (the trigger function for nobody).
revoke all on function private.apply_op(uuid, text, jsonb) from public, anon;
revoke all on function private.insert_version(uuid, uuid, date, jsonb) from public, anon;
revoke all on function private.audit(uuid, text, uuid, text, jsonb) from public, anon;
revoke all on function private.handle_new_user() from public, anon, authenticated;
-- apply_ops runs as the caller (RLS applies), so authenticated users need EXECUTE on the
-- internal helpers. The private schema is not exposed by the Data API, so they are not
-- reachable over HTTP.
grant execute on function private.apply_op(uuid, text, jsonb) to authenticated;
grant execute on function private.insert_version(uuid, uuid, date, jsonb) to authenticated;
grant execute on function private.audit(uuid, text, uuid, text, jsonb) to authenticated;
