# Documentation index

What exists in `docs/`, one line per item. To start, read the `README.md` at the
root, then `docs/ARCHITECTURE.md`.

## Getting started

- `docs/ONBOARDING.md` — the entry guide for a new team: access, environment, workflow, code conventions, database migrations, design system and what not to do.

## How the system works

- `docs/ARCHITECTURE.md` — the system map: pages, data, database, payments, video, email, scheduled jobs, translations, tests and security gates.

## Operations runbooks

- `docs/first-admin-setup.md` — how to create the first administrator and promote the next ones.
- `docs/BACKUP.md` — how the daily backup works, how to set it up and how to restore it.
- `docs/teacher-advisor-setup.md` — how to turn on the teacher's AI advisor (variables, knowledge base, reindexing).
- `docs/operational-account-controls.md` — how to suspend, block and restore an account, and where the database enforces it.
- `STRIPE_CHECKLIST.md` (at the root) — Stripe setup, field by field.

## Design

- `docs/design-system/skillset-design-system/` — the design system: colors, typography, buttons, cards and screen kits.
- `docs/design-v2/DESIGN-SYSTEM-V2.md` — the specification for the second version of the design (tokens and components).
- `docs/design-reference/skillset-design-v2-2/` — screen prototypes used as a visual reference (not production code).

## Translations

- `docs/i18n-archive/` — the Portuguese dictionary, kept for when the site offers Portuguese again, with the steps to turn it back on.

## Rules to keep this up to date

- A new document goes into this index.
- Plans, session reports, business strategy, investor material and
  security findings do **not** go into this repository: it is public.
- The test `src/app/documentation-paths.test.ts` checks that every path between
  backticks in this index, in `README.md`, in `docs/ARCHITECTURE.md` and in
  `docs/ONBOARDING.md` exists.
