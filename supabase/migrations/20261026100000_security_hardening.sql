-- THE ONE PERCENT · M2.5 · Advisor fixes (no data changes)
--
-- 0029 authenticated_security_definer_function_executable:
-- user_today() does not need SECURITY DEFINER. As SECURITY INVOKER it reads the caller's own
-- profile through RLS (other users' profiles are invisible, so it falls back to Europe/Madrid),
-- and service-role contexts bypass RLS. Triggers and RPCs always pass the caller's own id.
alter function public.user_today(uuid) security invoker;

-- 0001 unindexed_foreign_keys: covering indexes for the composite ownership keys.
create index if not exists habit_entries_habit_user on public.habit_entries (habit_id, user_id);
create index if not exists habit_schedule_versions_habit_user on public.habit_schedule_versions (habit_id, user_id);
create index if not exists habits_dimension_user on public.habits (dimension_id, user_id);
