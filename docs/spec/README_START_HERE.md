# THE ONE PERCENT — specification pack V1.2

This folder is a pre-development specification, not a deployed or functioning app.

## Contents
1. `PRODUCT_REQUIREMENTS.md` — functional product contract, especially Knowledge OS / Motivation Engine / sync.
2. `DESIGN_SYSTEM.md` — UI foundations, component inventory, responsive behavior.
3. `DATABASE_ARCHITECTURE.md` — Postgres data model, consistency and sync invariants.
4. `IMPLEMENTATION_PLAN.md` — milestone-by-milestone build plan and initial Claude Code prompt.

## Recommended use
Create a new repo / Claude Code project, copy all four core files to its root, then paste the **first prompt** in IMPLEMENTATION_PLAN.md. Review milestone M0/M1 output before allowing cloud-side changes.

## Open product decisions to validate during M0
- Authentication (email magic link vs passkeys), hosting/domain, retention policy and export cadence.
- Choice between a 1-to-10 topic rating and separate novelty/usefulness ratings (begin with 1-to-10).
- Push sending provider / background scheduler based on deployment constraints.
- Book metadata coverage and usage limits; API fallback is required.
- Whether public-figure imagery is provided by user or replaced by original theme illustrations.

## Security reminder
Never paste personal API keys into client components or commit `.env.local`.
