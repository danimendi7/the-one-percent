# THE ONE PERCENT — Product Requirements Document
Version: 1.2 | Status: Ready for implementation planning | Audience: owner + Claude Code

## 1. Product vision
A private, mobile-first Personal Performance OS. Fast habit execution, deep personal analytics, reading/knowledge acquisition, goals, focus, self-reflection and opt-in contextual motivation. The app shall be installable as a PWA and use **one account and one authoritative dataset** across mobile and desktop.

**Success principles**: register a binary habit with one tap; no duplicate activity logging; transparent analytics; explicit rest days; user-owned data; notifications respect preference, context and quiet hours; AI suggestions are opt-in and distinguish verified sources from generated synthesis.

## 2. Scope / target
- Single owner (private) in V1. Architecture supports user-scoped data for security but no social layer, public profiles or payments.
- Primary devices: modern desktop Chrome/Edge, iOS Safari installed PWA, Android Chrome installed PWA.
- Language: Spanish initial. i18n-ready; English motivational templates optional.
- Timezone default Europe/Madrid; store timestamps as UTC and calendar dates in user timezone.

## 3. Navigation and screens
**Desktop sidebar**: Overview, Habits, Analytics, Goals, Focus, Knowledge (Library, Discover, Brain), Mind & Energy, Reviews, Intelligence, Settings.
**Mobile bottom navigation**: Home, Habits, Focus, Insights, More. More surfaces Library, Discover, Brain, Goals, Reviews, Settings. Persistent shortcut to today's checklist.

### 3.1 Overview
- Daily progress, Top 3 priorities, due habits, focus CTA, learning CTA, dimension trends, active goals.
- Widgets reorganizable in later iteration; V1 order config and show/hide suffice.
- Data freshness / pending sync indicator visible.

### 3.2 Habit Engine
**Modes**: daily list, 7-day matrix, monthly calendar/heatmap, annual heatmap.
**Habit types**: binary, numeric threshold, duration, weekly count, reduction/limit, qualitative rating.
**Attributes**: name, icon, color, dimension, priority/weight (for optional weighted metrics), schedule, goal value/unit, start/end dates, reminders, paused/archived status, notes, related goals, source/activity linkage.
**Schedule rules**: selected weekdays, daily, N/week, N/month, date-range exceptions, planned rest, vacation template; versioned changes and historical schedule snapshots. The app must not retroactively change historical denominator when editing schedules.
**Registration**: single tap binary; quick numeric controls and direct entry; undo; notes optional; backfill with audit trail; offline-queued writes; optimistic UI with explicit failure/retry state.
**Completion denominator**: scheduled opportunities only; exclude exempt/paused dates, no penalties for non-scheduled days; weekly N-of-M targets calculate at period level; prevent double count for same opportunity. Numeric records preserve exact amounts even after goal met.
**Deletion**: default archive; destructive delete requires confirmation and offer export; history never silently lost.

### 3.3 Analytics
- Daily/weekly/rolling-30d completion and calendar heatmap; by habit, dimension and date range.
- Separate execution metrics from outcome metrics (e.g. workouts vs performance); no opaque 'success' score.
- Chart drilldown links to underlying entries. Display sample-size and missing-data states.
- Trends, consistency by weekday, habit stability, time in focus and reading, recorded self-ratings, goal measurements.
- Initially descriptive statistics only; correlations identified as exploratory, never causal.

### 3.4 Goals & Systems
- Hierarchy: vision > goal > system > habits. Goals contain metrics, baselines, targets, due dates, checkpoints and measurements.
- Many-to-many habit-goal links with no duplicate logging or mistaken automatic outcome progress.
- Show effort progress vs outcome progress separately.

### 3.5 Focus
- 25/50/90 min or custom; pause/resume; project/tag, planned outcome, actual outcome, optional self-rating; resilient timer based on clock timestamps across app backgrounding.
- Add completed sessions to analytics and, **when explicitly linked**, source relevant habit entries without duplicates.

### 3.6 Mind & Energy
- 15-second AM/PM check-ins: mood, energy, sleep hours, stress, free text; optional and independent of achievement score.
- Charts for trends and annotated comparisons; no diagnosis or medical promises.

### 3.7 Reviews
- Weekly and monthly reviews with calculated aggregates, highlights, user decisions (keep/change/remove), reflections and action items.
- Summary can be generated without AI; AI enrichment strictly optional.

## 4. Knowledge OS — complete V1 requirements
### 4.1 My Library
**Views**: cover grid / list; shelves Want to Read, Reading, Finished, On Hold, Favorites; filters and sorting; search by title, author, ISBN, tags, personal rating.
**Add book**: search Google Books and/or Open Library from server integration; select result; review imported title/author/ISBN/edition/pages/cover/source; manual entry when API fails or metadata incomplete; optional upload or URL to authorized cover.
**Book detail**: cover, metadata, status, start/end date, progress pages/percent, personal rating, genre/tags, reading sessions, notes (idea/quote/curiosity/reflection/question/application), optional page refs, saved source, inter-note links; no full copyrighted book ingestion by default.
**Data rules**: statuses independent of favorite flag. A book can have multiple editions only as explicit records; dedupe external IDs + user; preserve all notes if metadata is edited; page count unknown is supported; manual progress possible.
**Reading habit connection**: one reading session entry can feed minutes/pages and satisfy linked habits; deduplicate by activity ID, do not auto-complete unlinked habits.
**Search robustness**: cover image fallback; external API failures never block adding/editing books; attribute imported metadata to provider when required; proxy/cache where terms allow.

### 4.2 Daily Discovery
- Feed proposes personalized subjects from configured interests and history; user can also request custom questions.
- Content types: book concepts/summaries, philosophy, science studies, history, economics, technology, culture.
- Reading modes: 3/5/10 min, advanced depth default; structure: hook, explanation, mechanisms, example, nuance/limitations, practical use, takeaway, optional recall question.
- **Ratings** 1–10; bookmark, dismiss, 'already know', follow-up, topic history and duplicate avoidance; topic selection must avoid repeatedly generating variants of a disliked topic.
- Sources: citations with title, URL, published date and accessed date for claims requiring external verification. If source retrieval is unavailable, show 'unverified synthesis', do not invent named studies or links; bibliographic/source checks needed for scientific/recency claims.
- AI integration via provider adapter (e.g., configurable Gemini API); server-only keys, hard request/token quotas, caching, failure/fallback UI, no guarantee of perpetual free tier. Never send private journal/check-ins to model by default.
- First launch supports curated offline topics without any API key. AI mode is optional; recommend-only use of user-approved interests/ratings.
- No impersonation of copyrighted authors/third parties, no wholesale book text generation.

### 4.3 Knowledge Brain
- Notes and topic highlights convertible to manual/AI-suggested recall cards; user approves AI-generated cards.
- Reviews with Again/Hard/Good/Easy, spaced-review schedule, upcoming count and learning analytics.
- Version algorithm and due dates; support opt-out, card suspend, links to source book/topic.
- Personal knowledge search across book notes, discovery topics and cards.

## 5. Motivation Engine — complete V1 requirements
### 5.1 Profiles and tone
- Templates: Hardcore, Balanced, Calm; editable packs; language preference, profanity toggle, cap/day, per-category enable, time windows, quiet hours, days off.
- Use original inspirational copy rather than attributing fabricated quotations to public figures. Real quotations require source/verification. Character photos require authorized user-provided assets; no endorsement claim.
- All tone selection reversible, no guilt/escalation loops.

### 5.2 Triggers
- Morning activation, scheduled habit due, pending critical habits late-day, all goals for day achieved, weekly review due, recall cards due, optional focus block reminder.
- Context: user's timezone, scheduled/rest day, completed state, min gap between messages, daily cap, snooze/dismiss, delivery history, preference toggles.
- Trigger jobs run server-side, with idempotency key (user + rule + local date + slot), at-most-once send attempt policy with logged provider result; handle uncertain delivery without accidental duplicates.
- At send time re-evaluate due state; do not send reminder for completed/exempt habit. Do not push sensitive check-in details onto lock screen.

### 5.3 Push delivery
- PWA service worker, browser push subscription, permission requested only after clear user action, test notification UI; iOS installed PWA capability handling and graceful fallback to in-app notifications. Check compatibility in target OS/browser; large images and actions are best-effort.
- Delivery state: queued, attempted, accepted, rejected, revoked; browser display/reading is not guaranteed.
- Template preview and rule simulator: given date/time/context, explain whether notification would send and why.

## 6. Cross-device sync and offline
- One Supabase auth identity; RLS on every per-user table, server-only secrets, no public onboarding in V1.
- Server authoritative: local cache + optimistic UI + durable offline operation queue; idempotent mutations with op IDs; reconcile conflicts with explicit strategy and notify on collision for rich text.
- Realtime invalidation or polling when app open; background revalidation after reconnection.
- All dates use user timezone and DST-aware scheduling; no duplicate entry at midnight, across devices or during daylight savings change.
- Sync status: synced, pending, failed, conflict; offline accessible today view + recently used library where feasible.

## 7. Privacy, accessibility and reliability
- RLS and least privilege; secure cookies; CSRF/XSS defenses; secrets server-side; audit significant mutations.
- Export JSON and CSV; backup/restoration procedure tested. Account-private by default.
- Accessible controls, usable hit areas >= 44 CSS px for touch interactions where possible, text contrast, keyboard navigation, focus indicators, reduced motion.
- Performance targets (initial): mobile daily tracker usable in < 3s on decent 4G under warm cache, one-tap visual feedback < 100ms; monitor rather than guarantee on every device.

## 8. V1 boundaries / deferred
- No native Apple Health / Health Connect sync in initial V1; investigate feasibility afterward.
- No social features, billing, third-party marketplace, automatic access to ChatGPT 'Tema de hoy' chat history. Could manually import topics or summaries provided by the user; external chat data is not silently accessible.
- No full automatic research-quality fact checking without source retrieval.

## 9. Acceptance criteria (release gate)
1. An added Monday/Wednesday binary habit appears only on scheduled days; weekly denominator remains correct after schedule changed mid-month.
2. Mark on phone appears on desktop without manual duplicate creation; offline write syncs once after reconnect.
3. Reading 20 minutes creates one reading-session fact, updates reading progress, and completes linked reading duration habit only once.
4. Book can be added by API search or manually; all metadata and notes persist, edit and restore after fresh session.
5. Discover topics can be rated 1–10; topics saved; API outage retains reading/history and graceful fallback.
6. Notifications respect quiet time, planned rest, user cap and completion at send time; test harness verifies non-delivery for completed habit.
7. Push opt-in and revoke work; devices unsupported for push still receive in-app inbox.
8. All pages usable on 375px mobile screen; installable PWA manifest and worker; no critical horizontal overflow in daily view.
9. Private data inaccessible to another user ID in automated RLS tests.
10. Analytics computed from source records, are reproducible and date/DST edge-case tested.
11. Backups restored in a non-production environment; export validated.
12. V1 deploy has zero high-severity defects, onboarding documentation and rollback steps.
