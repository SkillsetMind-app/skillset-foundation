---
name: stack
description: Technology stack, library choices, and the reasoning behind them. Load when working with specific technologies or making decisions about libraries and tools.
triggers:
  - "library"
  - "package"
  - "dependency"
  - "which tool"
  - "technology"
edges:
  - target: context/decisions.md
    condition: when the reasoning behind a tech choice is needed
  - target: context/conventions.md
    condition: when understanding how to use a technology in this codebase
last_updated: 2026-06-25
---

# Stack

## Core Technologies

- **TypeScript 5** — primary language, `strict: true`, path alias `@/* → ./src/*`.
- **Next.js 16.2.6** (App Router, Turbopack) — single SSR app; `poweredByHeader: false`.
- **React 19.2.6** / **react-dom 19.2.6** — UI runtime.
- **Node.js 22** — app `.nvmrc` = 22; Firebase Functions runtime pinned to `nodejs22`.
- **Firebase 12.13.0** (client SDK: Auth, Firestore, Storage, Functions) — backend-as-a-service.
- **Firebase Functions 7.2.5** + **firebase-admin 13.10.0** — server payment runtime (separate `functions/` package).
- **Tailwind CSS 4.3.0** (via `@tailwindcss/postcss`) — styling.

## Key Libraries

- **Stripe** — app uses `stripe@22.1.1` (devDep / scripts) + `@stripe/stripe-js`, `@stripe/react-stripe-js`, `@stripe/connect-js`, `@stripe/react-connect-js`; functions package uses `stripe@20.4.1` (separate runtime — two Stripe versions, kept intentionally per-package).
- **Vitest 3.2.6** (not Jest) — all unit tests; jsdom environment, globals on, `vite-tsconfig-paths` for `@/` aliases.
- **@firebase/rules-unit-testing 5.0.1** — emulator tests for `firestore.rules` / `storage.rules` (separate `vitest.rules.config.ts`).
- **@testing-library/react 16.3.0** + **jest-dom** — component testing.
- **posthog-js** (client) / **posthog-node** (functions) — analytics.
- **lucide-react** — icons. **clsx** + **tailwind-merge** (`src/lib/cn.ts`) — className composition.
- **firebase-tools 15.18.0** — CLI for deploy + emulators.

## What We Deliberately Do NOT Use

- No mock/demo data in app paths — `window.SkillsetData`, `mockData`, `data.js` were removed; never reintroduce them (UI must read real Firestore).
- No CI service — deploys are manual scripts, not a pipeline.
- No `application_fee_amount` (destination charges) — payment model is `separate_charges_and_transfers`; the fee is reflected by reducing the teacher transfer (DECISIONS D2).
- No floats for money — all amounts are integer minor units (cents).

## Version Constraints

- Two Stripe major versions coexist by design: app `^22.1.1`, functions `^20.4.1` — keep them in their own `package.json`; do not unify without checking API compatibility.
- `package.json` `overrides` pin transitive deps (dompurify 3.4.11, postcss 8.5.15, protobufjs 7.6.4, uuid 11.1.1, ws 8.21.0, brace-expansion 5.0.6) for security/compat — do not loosen.
- Stripe is LIVE in production; the 6 plan Price IDs exist only in Stripe LIVE, not TEST (DECISIONS D20).
