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
last_updated: 2026-06-25
---

# Setup

## Prerequisites

- Node.js 22 (`.nvmrc` = 22; Firebase Functions also pinned to nodejs22)
- npm (the repo ships `package-lock.json`)
- Firebase CLI — `firebase-tools` (installed as a devDependency; used for emulators and deploy to project `skillsetusaofficial`)
- A Firebase project + Stripe keys to exercise auth/payments locally (app runs without them, but those flows are inert)

## First-time Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill the `NEXT_PUBLIC_FIREBASE_*` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` values (server Stripe secrets are NOT set here — they live in Firebase Functions secrets).
3. `npm install --prefix functions` (the `functions/` package is separate)
4. `npm run dev` — open `http://localhost:3000/`

## Environment Variables

Client (in `.env.local`, public — `NEXT_PUBLIC_*`):
- `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` (required for Firebase)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (required for payments UI; safe in browser)
- `NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED` (defaults `false`)
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (optional — analytics stay disabled when unset; host defaults to `https://us.i.posthog.com`)

Server (Firebase Functions secrets, NEVER in repo/client env):
- `STRIPE_SECRET_KEY` (required) — `firebase functions:secrets:set STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` (required) — `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET`
- `SKILLSET_APP_URL` (optional) — defaults to `https://skillsetusaofficial.web.app`

## Common Commands

- `npm run dev` — Next.js dev server on port 3000 (Turbopack)
- `npm test` — full Vitest unit suite (`vitest run`)
- `npm run test:watch` — Vitest in watch mode
- `npm run test:rules` — Firestore + Storage emulator tests for `firestore.rules`/`storage.rules`
- `npm run lint` — ESLint (next core-web-vitals + typescript configs)
- `npm run build` — production Next.js build
- `npm --prefix functions run build` — typecheck/compile the Functions package
- `npm run deploy:full` — deploy app (functions+hosting) **then** rules; use when in doubt

## Common Issues

**Changed `firestore.rules` or `storage.rules` but production runs stale rules:** the app deploy (`deploy:app` / `deploy:hosting`) does NOT include rules — you must run `npm run deploy:rules` separately (DEPLOY.md). This is what caused the long-standing cover-image HTTP 403.

**`npm run test:rules` times out on first run:** the Firestore/Storage emulator can be slow to initialize; rerun the command (observed in HANDOFF.md). Rules tests run without parallelism (`vitest.rules.config.ts`) to avoid concurrent `clearFirestore()`.

**Subscription flows can't be tested in Stripe TEST:** the 6 plan Price IDs exist only in Stripe LIVE, not TEST (DECISIONS D20); create equivalent TEST products/prices first to test in a non-prod environment.
