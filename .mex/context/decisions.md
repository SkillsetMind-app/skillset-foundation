---
name: decisions
description: Key architectural and technical decisions with reasoning. Load when making design choices or understanding why something is built a certain way.
triggers:
  - "why do we"
  - "why is it"
  - "decision"
  - "alternative"
  - "we chose"
edges:
  - target: context/architecture.md
    condition: when a decision relates to system structure
  - target: context/stack.md
    condition: when a decision relates to technology choice
last_updated: 2026-06-25
---

# Decisions

<!-- HOW TO USE THIS FILE:
     Each decision follows the format below.
     When a decision changes: DO NOT delete the old entry.
     Mark it as superseded, add the new entry above it.
     The history must be preserved — this is the event clock. -->

## Decision Log

> Full historical log lives in the repo root `DECISIONS.md` (D1–D21). The entries below are the load-bearing ones an agent must not violate.

### Single Next.js app split by route (not one-page prototype)
**Date:** 2026-04-20
**Status:** Active
**Decision:** Reshape the repo from a single Firebase landing page into one Next.js App Router app with separate route surfaces (Public, Learn, Teach, Ops/Admin).
**Reasoning:** Skillset must become a real platform; later modules (auth, checkout, publishing, moderation) need stable surfaces to attach to. Fastest solo-buildable form of the long-term architecture.
**Alternatives considered:** Keep the static Firebase one-pager (rejected — no room to grow). Split into multiple apps/repos (rejected — premature for a solo build).
**Consequences:** Everything ships from one app; product surfaces are route + feature folders under `src/app` and `src/components`.

### Payout hold = 30 days (D21, supersedes D3=7 and D16=10)
**Date:** 2026-06-06
**Status:** Active
**Decision:** `payoutReleaseDelayDays = 30` is the canonical, final value. Refund window stays at 7 days (`refundWindowDays`/`automaticRefundWindowDays = 7`).
**Reasoning:** 30 > 7 guarantees a released payout never precedes a still-refundable charge, with slack for webhook delay. Engine already runs 30 (`functions/src/payment-rules.ts:12`) and all UI copy derives from `payoutClearDays = 30` (`src/data/plans.ts`).
**Alternatives considered:** 7 (D3) and 10 (D16) — intermediate values, superseded.
**Consequences:** Single source of truth = BE `payoutReleaseDelayDays=30` + FE `payoutClearDays=30`. Any "7/10 days" in docs is stale.

### `separate_charges_and_transfers`, no `application_fee_amount` (D2)
**Date:** 2026-05-19
**Status:** Active
**Decision:** Keep the Stripe charge model as `separate_charges_and_transfers`; reflect the platform fee by reducing the teacher transfer (`teacherNetMinor`), not via `application_fee_amount`.
**Reasoning:** Changing the charge architecture (to destination charges) without founder review is risky; current model is financially equivalent.
**Alternatives considered:** Destination charges with `application_fee_amount` (rejected — architectural change, needs supervision).
**Consequences:** `domain/payment-split.ts` is the money-math source of truth; `functions/src/index.ts` mirrors it; the teacher absorbs the Stripe fee so the platform keeps full commission.

### Commission resolved server-side from the teacher's plan (D18)
**Date:** 2026-05-25
**Status:** Active
**Decision:** The server ignores client-sent bps and resolves the platform fee from the teacher's current plan: Free 800 / Starter 400 / Pro 100 / Plus 0 bps; the order snapshots the rate used.
**Reasoning:** Trusting client bps is exploitable; snapshotting preserves historical accuracy of past sales.
**Alternatives considered:** Accept client-supplied bps (rejected — security/integrity risk).
**Consequences:** Checkout/draft callables resolve bps from plan; `DEFAULT_PLATFORM_FEE_BPS = 800` (Free) for anyone without an active plan.

### Stripe LIVE is the current production environment (D20)
**Date:** 2026-06-06
**Status:** Active
**Decision:** Production points at Stripe LIVE; `.env.local`/`.env.production` use the LIVE publishable key and the 6 plan Price IDs exist in Stripe LIVE.
**Reasoning:** Equivalent TEST Price IDs were never created; LIVE is what is validated and deployed.
**Alternatives considered:** Run everything against TEST (rejected — no TEST Price IDs for plans).
**Consequences:** Full subscription testing in a non-prod env requires creating separate TEST products/prices first. Secrets live only in Firebase Functions secrets, never in client env or git.

### Stripe Connect onboarding is just-in-time, not at signup (D12)
**Date:** 2026-05-25
**Status:** Active
**Decision:** Do not force Connect at signup/login; only require it when a teacher actually needs to receive money (publish paid course / payout). Plans (Free/Starter/Pro/Plus) are Stripe **Billing**, a separate subsystem from Connect.
**Reasoning:** Deferred onboarding is the Stripe-recommended pattern and reduces signup friction; Connect (receiving) and Billing (paying for the plan) coexist independently.
**Alternatives considered:** Force Connect at signup (rejected — unnecessary friction).
**Consequences:** Connect prompt fires inside `createCheckoutSession` when payout is unconfigured; remaining friction is messaging only.

### Errors must be observable, never silenced (D5/D8)
**Date:** 2026-05-19
**Status:** Active
**Decision:** Fix proven defects and make root causes observable rather than "fixing in the dark"; remove error-swallowing (`.catch(() => undefined)`, empty `catch {}`).
**Reasoning:** Three swallow points hid the profile-photo failure; engineering honesty requires not claiming "resolved" without verification.
**Alternatives considered:** Patch Firestore rules by guess (rejected — could weaken security without evidence).
**Consequences:** All catches log with context (8 metrics catches retrofitted); empty catches are banned project-wide.
