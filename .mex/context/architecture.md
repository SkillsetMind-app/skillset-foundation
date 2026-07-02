---
name: architecture
description: How the major pieces of this project connect and flow. Load when working on system design, integrations, or understanding how components interact.
triggers:
  - "architecture"
  - "system design"
  - "how does X connect to Y"
  - "integration"
  - "flow"
edges:
  - target: context/stack.md
    condition: when specific technology details are needed
  - target: context/decisions.md
    condition: when understanding why the architecture is structured this way
last_updated: 2026-06-25
---

# Architecture

## System Overview

Skillset is a course marketplace shipped as ONE Next.js (App Router) app on Firebase Hosting Web Frameworks (SSR), split by route into Public, Learn (student), Teach (teacher), and Ops/Admin surfaces. Browser flow: a Server/Client Component in `src/app/**/page.tsx` renders → client code calls a thin data module in `src/lib/data/*` → that module uses the Firebase client SDK (`getFirestoreDb()` / `getFirebaseStorage()` from `src/lib/firebase/client.ts`) to read/write Firestore + Storage directly, guarded by `firestore.rules`/`storage.rules`. Pure business logic (money math, access checks, validation) lives in `src/domain/*` and is imported by both UI and data layers. Money + payment side effects go through Firebase **Functions** (`functions/src/index.ts`): the browser invokes callables (checkout, course-draft, refund) and Stripe posts back to the `stripeWebhook` HTTPS function, which writes `orders` and `payoutLedger`.

## Key Components

- **`src/domain/*`** — pure, framework-free business rules (e.g. `payment-split.ts` = canonical money math, `course-access.ts`, `enrollment.ts`); no Firebase imports, fully unit-tested.
- **`src/lib/data/*`** — Firestore/Storage access modules (one per collection-area: `orders.ts`, `enrollments.ts`, `teacher-courses.ts`, `payout-ledger.ts`, `course-assets.ts`); marked `"use client"`, use the client SDK + `onSnapshot` subscriptions.
- **`src/lib/firebase/client.ts`** — lazy singleton accessors (`getFirebaseApp/Auth/FirestoreDb/Storage/Functions`); Functions pinned to region `us-central1`.
- **`functions/src/index.ts`** — server-side Stripe runtime: checkout callables, the `stripeWebhook` endpoint, subscription lifecycle, payout ledger writes; mirrors `domain/payment-split.ts` and must stay in sync with it.
- **`firestore.rules` / `storage.rules`** — the real authorization layer; clients hit Firestore/Storage directly, so access is enforced here (e.g. enrollment-gated reads of protected course assets), not in app code.

## External Dependencies

- **Firebase (Auth, Firestore, Storage, Functions, Hosting)** — project `skillsetusaofficial`; primary datastore, auth, file storage, SSR host, and serverless payment runtime.
- **Stripe** — payments via `separate_charges_and_transfers` (Connect for teacher payouts, Billing for Free/Starter/Pro/Plus plans); secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) live only in Firebase Functions secrets, never client-side.
- **PostHog** — product analytics, client (`posthog-js`) and server (`posthog-node` in functions); disabled when keys are unset.

## What Does NOT Exist Here

- No separate backend/API server — server logic is only Next.js SSR + Firebase Functions; there is no Express/REST layer.
- No ORM or repository abstraction over Firestore — `src/lib/data/*` calls the Firebase SDK directly; authorization is in security rules, not a server middleware.
- No mock/seed data layer in production paths — `window.SkillsetData`, `mockData`, and `data.js` were deliberately removed; UI reads real Firestore data (`docs/demo` is reference only).
- No CI/CD — deploys are manual from a developer machine (see `setup.md`).
