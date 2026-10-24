# THE ONE PERCENT — Data architecture V1.2

## Principles
PostgreSQL/Supabase; user-scoped entities and RLS; UTC timestamps (`timestamptz`) + IANA timezone stored on profile; local date (`date`) for habit/day records; IDs UUID; `created_at`, `updated_at`, `deleted_at` where applicable. No anonymous read/write access; service role only on backend. RLS enabled for every private table.

## Domain model
### Identity
- `profiles(id [auth.users FK], timezone, locale, settings_json, created_at, updated_at)`
- `dimensions(id, user_id, slug, name, sort_order, color, archived_at)`

### Habits & source activities
- `habits(id, user_id, dimension_id, title, habit_type, unit, target_value, target_direction, priority, state, created_at, archived_at)`
- `habit_schedule_versions(id, habit_id, valid_from_date, valid_until_date, schedule_kind, weekdays_json, target_count, period_kind, excluded_dates_json, template_id)`
- `habit_entries(id, user_id, habit_id, local_date, value_numeric, value_bool, rating, note, source_activity_type, source_activity_id, client_op_id, created_at, updated_at)`
- `routine_templates(id, user_id, title, rules_json)`; `routine_calendar(id, user_id, local_date, template_id, rest_flag)`
- `activity_events(id, user_id, activity_type, activity_id, occurred_at, metadata_json)` optional canonical event log for cross-module provenance.

**Important**: preserve versions for historical evaluation; unique `(user_id, client_op_id)` for idempotent operations, and enforce appropriate unique per-habit-per-date policies (or upserts where multiple numeric entries are aggregated). Aggregate daily value from child records if repeated events must be counted. Do not naively store a one-row/day key for activities that allow multiple sessions.

### Goals & focus
- `goals(id, user_id, parent_goal_id, title, metric_type, unit, baseline, target, due_date, state)`
- `goal_habits(goal_id, habit_id)`
- `goal_measurements(id, goal_id, observed_on, value, note)`
- `focus_sessions(id, user_id, started_at, ended_at, active_seconds, project, planned_output, actual_output, rating, client_op_id)`
- `daily_priorities(id, user_id, local_date, sort_order, title, completed_at)`

### Wellness & review
- `daily_checkins(id, user_id, local_date, checkin_phase, mood, energy, stress, sleep_hours, note)`
- `reviews(id, user_id, period_kind, period_start_date, period_end_date, metrics_snapshot_json, reflection, keep_json, change_json, drop_json, created_at)`

### Knowledge / Library
- `books(id, user_id, title, subtitle, author_display, isbn10, isbn13, external_provider, external_id, edition, language, page_count, cover_url, cover_storage_path, description, status, is_favorite, user_rating, started_on, finished_on, created_at)`
- `book_authors(book_id, author_name, sort_order)` optional normalization later.
- `reading_sessions(id, user_id, book_id, occurred_at, local_date, minutes, pages_from, pages_to, pages_read, notes, client_op_id)`
- `book_notes(id, user_id, book_id, note_type, body, page_reference, is_favorite, created_at, updated_at)`
- `knowledge_tags(id, user_id, name)`; `knowledge_links(id, user_id, from_entity_type, from_entity_id, to_entity_type, to_entity_id)`
- `discovery_topics(id, user_id, subject, category, content_markdown, difficulty, minutes_estimate, generation_mode, verification_status, source_metadata_json, prompt_version, provider_name, model_name, created_at)`
- `topic_feedback(id, user_id, topic_id, rating_1_to_10, dismissed_reason, saved, read_at, feedback_text)`
- `interest_preferences(id, user_id, category, weight, excluded, updated_at)`
- `recall_cards(id, user_id, source_type, source_id, question, answer, state, algorithm_version, due_at, interval_days, ease_factor)`
- `recall_attempts(id, user_id, recall_card_id, responded_at, grade, due_at_before, due_at_after)`

### Motivation
- `notification_rules(id, user_id, trigger_type, enabled, timezone, rule_config_json, priority, quiet_hours_override, created_at)`
- `notification_templates(id, user_id, tone, locale, title, body, image_asset_id, is_original, quote_source_url, enabled)`
- `push_subscriptions(id, user_id, device_label, endpoint_ciphertext, key_material_ciphertext, browser, revoked_at, created_at)`
- `notification_deliveries(id, user_id, rule_id, template_id, scheduled_for, idempotency_key, state, provider_response_json, attempted_at)`
- `notification_preferences(user_id, tone, profanity_enabled, daily_cap, quiet_start_local, quiet_end_local, weekdays_json, push_enabled)`
- `media_assets(id, user_id, storage_path, usage_type, rights_confirmation, created_at)`

### Reliability
- `sync_operations(id, user_id, device_id, client_op_id, operation_type, payload_hash, outcome, created_at)`
- `audit_logs(id, user_id, entity_type, entity_id, action, occurred_at, metadata_json)`

## Relationships / ownership
Every private record references `user_id` directly or via parent and is constrained by RLS using `auth.uid()`. Composite FKs or validated triggers prevent linking one user's habit to another user's goal/book. Unique indexes: `habit_entries(user_id,client_op_id)`, `reading_sessions(user_id,client_op_id)`, `notification_deliveries(idempotency_key)`, `daily_checkins(user_id,local_date,checkin_phase)`.

## Computation contracts
- Binary daily habit: complete iff `value_bool=true` on scheduled date.
- Numeric target: complete if aggregated value >= minimum or <= maximum (with explicit semantics). Never infer a missing numeric reduction value means success.
- Weekly-frequency habit: define scheduled opportunity window and count of achieved sessions; denominator at frequency target level, not seven unchecked weekdays.
- `% completion`: fulfilled scheduled opportunities / total applicable scheduled opportunities; all-exempt period = N/A, not 0 or 100.
- Planned rest/holidays exempted according to historical schedule; no silent recalculation when habit config changes.
- Reading pages/minutes originate in `reading_sessions`, habit fulfillment is derived or linked by source ID, not duplicated manual writes.
- Display breakdown of scores and date range in UI.

## Offline synchronization
Maintain persistent local operation queue (IndexedDB), each operation carries id, device id, creation time, entity, expected version. Server transactional upsert with idempotency key. For binary mark/unmark use **set desired state** operation instead of toggle to avoid double toggles. For rich notes, conflict detection via version/updated_at and user-driven merge. Multi-device subscriptions refresh read models on changes.

## Security & testing
- RLS policies CRUD user only; test cross-user access systematically; private bucket for user-uploaded images; signed access where needed.
- External book APIs and AI endpoints called through server to protect tokens, enforce rate limits and validate responses.
- Push subscriptions contain secrets: encrypted at rest, never serialized into analytics or sent to client except during registration.
- Avoid including mood, notes or book excerpts in notification lock-screen text by default.
- Migration sequencing and rollback planning; daily backup/export strategy; test restore before launch.

## Migration order
1. identity/dimensions; 2. habits/schedules/entries; 3. goals/focus/checkins; 4. books/reading/notes; 5. discovery/recall; 6. push/rules; 7. audit/sync optimization; 8. indexes/analytics views.
