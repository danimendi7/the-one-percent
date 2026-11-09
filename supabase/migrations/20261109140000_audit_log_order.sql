-- C6 · Change history of a habit. Additive: only the default of one column changes.
-- apply_ops runs a whole batch in one transaction, and now() is the same for all of it, so several
-- changes sent together (edits made offline) had the same time and no defined order. The clock
-- instant keeps them in the order they were applied. Existing rows do not change.
alter table public.audit_logs alter column occurred_at set default clock_timestamp();
