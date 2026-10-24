# THE ONE PERCENT — Claude Code implementation plan V1.2

## Working agreement
Build incrementally; never generate an entire app in one uncontrolled prompt. Always inspect repo, propose change set, implement, run lint/typecheck/tests, capture screenshots on desktop/mobile, report done vs pending, commit coherent changes. Never fabricate API behavior, AI facts, push delivery, tests or completion. No production database mutations without explicit approval. Keep environment secrets out of repo.

## Milestones and exits
### M0 — Scaffold + contracts
Deliver Next.js TypeScript project, Tailwind/shadcn tokens, documented screen map, data model, Supabase local migrations setup, lint/tests/CI, env example, README. Exit: build clean, routes skeleton, 375/1440 screenshots, security checklist.

### M1 — Visual prototype
Create shell, desktop sidebar, mobile tabs, overview, habit matrix, analytics shell, library and discover mock, push settings mock. Use fixtures only, clearly label demos. Exit: no dead navigation; usability on mobile; accessible input and empty states.

### M2 — Auth, habits & reliable sync
Private sign-in, profiles, RLS, habits CRUD, schedule versions, checkbox/numeric entry, offline operation queue, multi-device synchronization and conflict UX. Exit: acceptance tests for weekly schedule, changing target dates, idempotency, reconnect, timezone DST.

### M3 — Real analytics, goals, focus
Trusted metric functions with tests; chart drilldowns and filters; goals and activity linkage; focus timer; AM/PM check-in. Exit: reproducible numbers, no duplicate entries, correct N/A.

### M4 — Knowledge OS
Books search Google Books/Open Library with manual fallback, cover grid, shelves, details, notes and reading sessions; Discovery curated mode + optional provider adapter and citations; ratings/history; basic spaced recall. Exit: book entry persists; reading session can complete linked habit once; no hallucinated citation displayed as verified.

### M5 — Motivation Engine
Notification profiles, rule editor, contextual evaluator, quiet hours, daily cap, browser push opt-in, device subscription, server scheduled job, inbox fallback, delivery ledger and simulator. Exit: no push for completed/rest-day habit; cross-device subscriptions independent; dismiss/unsubscribe respected; tests on target browsers/OS.

### M6 — Reviews, AI & release
Weekly/monthly reports with factual aggregations; opt-in AI explanation and topic suggestions, limits/cost guardrails; export/restore; reliability/security/performance/e2e; PWA installation guide and deploy. Exit: release criteria PRD section 9 all pass, rollback docs and restoration drill.

## Main tech choices
Next.js App Router + TS; Tailwind + shadcn/ui + Lucide; Supabase Auth/Postgres/RLS/Storage; TanStack Query; Recharts; Zod; Vitest; Playwright; IndexedDB local queue; Vercel deployment; optional model-provider adapter (configurable and rate-limited).

## Engineering notes
- Keep business logic under `features/*/domain` pure functions to facilitate tests.
- Server-derived aggregates should respect historical schedule versions.
- Use a single activity provenance ID across modules.
- User timezone is persistent and configurable. Test Europe/Madrid DST boundary.
- Notification scheduler must handle no-traffic periods and missed execution; enforce idempotency.
- Do not depend on Gemini/free tier for core app: curated topics and manual workflows remain functional.
- Profile custom images require user ownership/rights confirmation and no false endorsements.

## Claude Code suggested first prompt
```text
You are the engineering lead for THE ONE PERCENT. Read PRODUCT_REQUIREMENTS.md, DESIGN_SYSTEM.md, DATABASE_ARCHITECTURE.md and IMPLEMENTATION_PLAN.md in full. Do not start coding until you have:
1. Audited any existing repo files and environment.
2. Identified assumptions/conflicts and proposed explicit resolutions.
3. Produced an execution plan for M0 and M1 only, including repo structure, tests, security and responsive UI criteria.
4. Listed exact commands you intend to run.
After that, implement M0 and M1 in incremental verified steps, stopping before any production cloud or paid API action. Use realistic mocked data and label it. Implement no fake backend/sync/push behavior. After each step run typecheck, lint, tests and summarize remaining gaps.
```

## Launch quality gates
- Cross-device freshness tested with two sessions.
- Strict RLS; secrets never committed.
- Mobile install works; fallback for unsupported push.
- App usable if AI key missing or quota exhausted.
- Offline queue retry works and state visible.
- All book cover/image paths fallback safely.
- A full export and test restore demonstrably work.
- Screenshots and Playwright flows for desktop/mobile.
