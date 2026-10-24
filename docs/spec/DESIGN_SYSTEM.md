# THE ONE PERCENT — Design System V1.2
## Direction
Dark Performance: precise, premium, readable, functional. Avoid gaming UI and overuse of lime. Responsive and touch-first.

## Tokens
| Token | Hex | Use |
|--|--|--|
| background | `#0B0F14` | app canvas |
| surface | `#161D26` | panels |
| surfaceRaised | `#202A34` | hover/detail |
| border | `#26313D` | fine outlines |
| accent | `#B9F36A` | completed/action/focus |
| textPrimary | `#F3F6F8` | main copy |
| textSecondary | `#AAB5C1` | helper copy |
| amber | `#D9AB6C` | actual warning / near due |
| error | `#EF7C82` | errors |

Typography: Geist or Inter; scale 12/14/16/20/24/32; body 14–16; respect large text. Spacing 4px grid, card radius 12–16px, subtle shadows. Icons Lucide. Accent sparingly.

## Layout
Desktop >= 1024: sidebar 240px, central content max 1400px, 12-col responsive grid; tablet 768–1023 compact rail; mobile <= 767 bottom 5 tabs Home/Habits/Focus/Insights/More. All primary actions reachable within 1–2 taps.

## Core components
`AppShell`, `BottomTabs`, `MetricCard`, `HabitRow`, `HabitDayCell`, `WeeklyHabitGrid`, `MonthlyHeatmap`, `QuantitativeQuickEntry`, `StreakIndicator`, `DateRangePicker`, `FilterBar`, `GoalProgress`, `ChartPanel`, `BookCoverCard`, `BookDetailsDrawer`, `BookNoteEditor`, `ReadingSessionInput`, `TopicCard`, `RecallCard`, `NotificationRuleEditor`, `PushPermissionExplainer`, `SyncStatus`, `EmptyState`, `Toast`, `ConfirmDialog`.

## Main screens UX
1. **Overview** above fold: today's due/complete, 3 priorities and one-tap checklist CTA. Analytics secondary.
2. **Habits** default weekly on desktop and today/weekly toggle on mobile; horizontally scroll weekday matrix with sticky names; minimum 44px touch targets via spacing/container; taps instantly optimistic and undoable; dynamic category collapse. Num/duration opens tiny inline controls.
3. **Knowledge > Library** cover grid with shelves tabs and search; tap cover opens metadata, reading controls, notes; search-result ingestion preview and manual fallback. Skeleton and missing-cover designs.
4. **Discover** featured card plus reading view (comfortable measure, reading estimate and references), quick 1–10 rating and save; 'already know' / 'not interested' actions. Clearly label AI-generated vs curated and source status.
5. **Brain** single-question recall card, reveal then difficulty selection. Queue count and source context.
6. **Notifications settings** mode choice, language, profanity, schedule, triggers, daily maximum, quiet hours, preview and send-test; clear on/off and permission status.
7. **Analytics** high-level cards + accessible graphs, adjustable periods, table alternatives; explain score calculations.

## States
Every async experience needs loading, empty, offline, error and success states. For save: synced, pending sync, failed/retry and conflict. Avoid flashing success on server failure. User feedback must be comprehensible without green/red alone.

## Motion
120–180ms small transitions, no celebration overload. Honor prefers-reduced-motion. No auto-playing audio or jump-scare push.

## Accessibility / copy
AA contrast target, focus visibility, semantic headings and form labels, icon text alternatives, keyboard edit, tooltips, no punitive shame. Motivational profanity gated behind opt-in Hardcore mode.

## Screen acceptance checklist
- At 375px width: no clipped essential control; usable keyboard; bottom tabs don't hide action.
- At 1440px: balanced whitespace, readable data density.
- Dark palette token-driven, no scattered hardcoded colors.
- Push permission not requested until user deliberately enables it.
- Imported book covers never distort; use object-fit cover/contain appropriately.
