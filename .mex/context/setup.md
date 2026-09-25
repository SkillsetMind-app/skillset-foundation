---
name: setup
description: Dev environment setup and commands. Load when setting up the project for the first time or when environment issues arise.
triggers:
  - "setup"
  - "install"
  - "environment"
  - "getting started"
  - "how do I run"
  - "local development"
edges:
  - target: context/stack.md
    condition: when specific technology versions or library details are needed
  - target: context/architecture.md
    condition: when understanding how components connect during setup
last_updated: 2026-09-25
---

# Setup

The app is a single Next.js project (App Router) deployed on Vercel. The backend
is Supabase (Postgres, Auth, Storage). Payments run in Next.js Route Handlers
under `src/app/api/` — there is no separate functions package. Server secrets
live in the Vercel project environment variables; locally they go in
`.env.local`. Read `AGENTS.md` before writing UI.

## Prerequisites

- Node.js — `.nvmrc` pins `24`; CI (`.github/workflows/ci.yml`) runs on Node 22.
- npm (the repo ships `package-lock.json`).
- A Supabase project (URL + anon key) for auth/data to work locally. Without
  them the Supabase config returns `null` and callers render a "being set up"
  state (`src/lib/supabase/config.ts`).
- Stripe keys only if you need to exercise payments; without
  `STRIPE_SECRET_KEY` the payment routes stay dormant.
- Optional, for the database smoke tests: `psql` on the PATH and the Supabase
  CLI (CI uses it to start a throwaway Postgres).

## First-time Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in what you need (see below).
   Never commit a real value.
3. `npm run dev` — Next.js dev server (Next's default port, 3000).

## Environment Variables

Names only. Most are documented in `.env.example`; the rest are only read in
the file cited next to them. Production values are set in the Vercel project
environment. `NEXT_PUBLIC_*` values end up in the browser
bundle; everything else is server-only and must never get that prefix.

Public (`NEXT_PUBLIC_*`):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase client (`src/lib/supabase/config.ts`).
- `NEXT_PUBLIC_SUPABASE_UPLOAD_LIMIT_MB` — per-file Storage upload cap used by client validation.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Stripe.js / embedded checkout.
- `NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED`, `NEXT_PUBLIC_PAYMENTS_CARD_INSTALLMENTS_ENABLED` — payment feature flags.
- `NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID` — optional Bunny Stream video library; unset means video uploads go to Supabase Storage.
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` — optional analytics.
- `NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED`, `NEXT_PUBLIC_PLATFORM_ASSISTANT_ENABLED`, `NEXT_PUBLIC_AUTH_MFA_ENABLED`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` — feature flags (Google: `src/lib/auth/providers.ts`).
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — optional; the Turnstile widget is off when unset (`src/components/auth/turnstile-widget.tsx`).
- `NEXT_PUBLIC_WHATSAPP_NUMBER` — optional contact link (`src/components/site/whatsapp-contact.tsx`).

Server-only:
- `SUPABASE_SERVICE_ROLE_KEY` — service-role client (`src/lib/supabase/admin.ts`); required by the money routes (checkout, webhook, refunds), which fail with a 500 without it.
- `STRIPE_SECRET_KEY` — Stripe server client (`src/lib/payments/server/stripe.ts`).
- `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` — signing secrets of the platform and Connect webhook endpoints; `src/app/api/webhooks/stripe/route.ts` accepts either.
- `SKILLSET_APP_URL` — optional absolute origin for Stripe return URLs; falls back to `SITE_URL` (`src/lib/payments/server/app-url.ts`).
- `CRON_SECRET` — bearer secret for `/api/cron/*`; unset means every cron request is rejected (`src/lib/cron/authorized.ts`).
- `RATE_LIMIT_PEPPER` — HMAC pepper for hashed-IP rate-limit keys (`src/lib/supabase/rate-limit.ts`).
- `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_TOKEN_KEY` — Bunny Stream uploads and signed playback (`src/lib/bunny/server.ts`).
- `RESEND_API_KEY` — purchase access email; skipped with a warning when unset (`src/lib/payments/server/purchase-access-email.ts`).
- `KIMI_API_KEY`, `OPENAI_API_KEY`, `ADVISOR_KNOWLEDGE_DOC_URL` — teacher advisor and its retrieval corpus.
- `N8N_ASSISTANT_WEBHOOK_URL`, `N8N_ASSISTANT_WEBHOOK_SECRET` — public help-center assistant.
- `OPS_ALERT_WEBHOOK_URL`, `OPS_ALERT_WEBHOOK_SECRET` — ops alerts (`src/lib/ops/alert.ts`); inert when unset.
- `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` — custom-domain management via the Vercel API (`src/lib/domains/server/vercel-domains.ts`).
- `GEO_ALLOWED_COUNTRIES` — read by `src/proxy.ts`.

## Common Commands

- `npm run dev` — Next.js dev server.
- `npm run build` — production Next.js build.
- `npm run lint` — ESLint.
- `npx tsc --noEmit -p .` — typecheck.
- `npm test` — full Vitest suite (`vitest run`; collects `src/**/*.test.{ts,tsx}`).
- `npx vitest run <file> --pool=forks --maxWorkers=1` — run one test file.
- `npm run test:watch` — Vitest in watch mode.
- `npm run test:db` — SQL smoke tests in `supabase/tests/` via `psql`; needs `DATABASE_URL`. They write (inside a rolled-back transaction), so never point them at production.

## Local Supabase

`supabase/config.toml` configures the Supabase CLI local stack (API 54321,
Postgres 54322, Studio 54323). `supabase db reset` does **not** rebuild the
schema from `supabase/migrations/`: the migration chain does not replay from
zero. The replayable schema is the baseline in `supabase/schema/` plus the
later migrations, applied by `scripts/build-test-db.sh`:

```
DATABASE_URL='postgresql://...' bash scripts/build-test-db.sh
DATABASE_URL='postgresql://...' npm run test:db
```

The `rls` job in `.github/workflows/ci.yml` shows the full sequence (start an
empty Supabase Postgres with the CLI, then apply the schema, then run the tests).

## Common Issues

**The test suite passes but a dialog is off-screen:** jsdom has no layout
engine. Check layout in a real browser at ~700px height (`AGENTS.md` §1).

**Plan or activation checkout fails against a different Stripe account/mode:**
the plan and activation-fee Price IDs are hard-coded in `src/data/plans.ts`;
the Stripe account in use must have those prices, or they must be replaced.

**Stripe webhook returns 503 `payments_not_configured`:** `STRIPE_SECRET_KEY`
is missing or malformed, or neither webhook signing secret is set. A live event
reaching a server with a test key also gets 503 so Stripe keeps retrying it.
