---
name: conventions
description: How code is written in this project — naming, structure, patterns, and style. Load when writing new code or reviewing existing code.
triggers:
  - "convention"
  - "pattern"
  - "naming"
  - "style"
  - "how should I"
  - "what's the right way"
edges:
  - target: context/architecture.md
    condition: when a convention depends on understanding the system structure
last_updated: 2026-06-25
---

# Conventions

## Naming

- Files: kebab-case (`payment-split.ts`, `course-assets.ts`, `security-settings-panel.tsx`) — including React component files.
- Functions: camelCase, verb-first (`computePaymentSplit`, `subscribeToOrder`, `getFirestoreDb`, `createTeacherCourseDraft`).
- Exported constants: SCREAMING_SNAKE_CASE (`DEFAULT_PLATFORM_FEE_BPS`).
- Imports use the `@/` alias for everything under `src/` (`@/lib/firebase/client`, `@/domain/order`) — never deep relative paths.
- Money variables carry minor-unit suffixes (`grossMinor`, `stripeFeeMinor`, `teacherNetMinor`, `platformFeeBps`).

## Structure

- Pure business logic lives in `src/domain/*` — no Firebase/Next imports, fully unit-tested. Firestore/Storage access lives in `src/lib/data/*` (one module per collection-area). Never put Firebase SDK calls in `src/domain`.
- Data-access and client modules start with `"use client";` and use the lazy Firebase accessors from `src/lib/firebase/client.ts` (never call `initializeApp` directly elsewhere).
- Tests are colocated next to source: `payment-split.ts` → `payment-split.test.tsx` (app uses `.test.tsx`, functions use `.test.ts`).
- `functions/` is a separate package with its own `package.json`, `node_modules`, and Stripe version; it mirrors `domain/payment-split.ts` and must be kept in sync.
- `domain/payment-split.ts` is the SOURCE OF TRUTH for money math; the webhook runtime in `functions/src/index.ts` mirrors it.

## Patterns

Never silently swallow errors — surface them with context. Empty `catch {}` and `.catch(() => undefined)` are explicitly banned (DECISIONS D5/D8); they hid the cover-image 403 and profile-photo bugs.
```
// Correct
catch (error) { logger.error("upload failed", { error, context }); throw error; }

// Wrong (banned)
catch { /* swallow */ }
.catch(() => undefined)
```

Money is integer minor units, never a float; commission rate comes from the teacher's server-resolved plan (Free 800 / Starter 400 / Pro 100 / Plus 0 bps), never from client-supplied bps (DECISIONS D18).
```
// Correct: compute split with minor units + server-authoritative bps
const split = computePaymentSplit(grossMinor, currency, platformFeeBps);
```

Authorization lives in `firestore.rules` / `storage.rules`, not in app code — clients read Firestore/Storage directly, so gating (e.g. enrollment-protected assets) is enforced and tested in rules.

## Verify Checklist

Before presenting any code:
- [ ] No Firebase SDK calls inside `src/domain/*` (pure logic only).
- [ ] No empty `catch {}` or `.catch(() => undefined)` — errors logged with context and rethrown.
- [ ] Money handled as integer minor units; commission bps resolved server-side from plan, not client.
- [ ] Imports use the `@/` alias, not deep relative paths.
- [ ] New file is kebab-case; any new test is colocated (`*.test.tsx` app / `*.test.ts` functions).
- [ ] If `firestore.rules` or `storage.rules` changed, rules tests run (`npm run test:rules`) and a separate `deploy:rules` is required.
- [ ] `npm run lint`, `npm test`, and `npm run build` pass.
