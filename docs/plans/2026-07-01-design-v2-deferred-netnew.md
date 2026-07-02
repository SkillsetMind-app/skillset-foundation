# Design V2 — Deferred Net-New & Rejected (D3/D4/D2 manifest)

**Date:** 2026-07-01 · **Branch:** `feat/design-v2` · Companion to `2026-07-01-design-v2-implementation.md`.

This records what the V2 handoff mock (`screens/*.jsx`) contains that was **NOT** implemented in the overnight design pass, and why. Two reasons only: (a) it's a **net-new product feature** requiring a data model / backend that doesn't exist (a product decision, D3 — not a design port), or (b) it's **fabricated engagement UI** with no real backing (would violate Constitution Art. IV "No Invention"). Nothing here is a visual gap on an existing surface — those were handled per-surface and committed.

## Mock inventory → disposition

| V2 mock (`screens/`) | Repo counterpart | Disposition |
|---|---|---|
| Auth, Onboarding, Pricing, Notifications | built | ✅ DONE (Wave 1, committed) |
| Discover | `courses/course-marketplace.tsx` | ✅ DONE (Wave 2, `6ebf6af`) |
| Classroom | `learn/enrolled-course-workspace.tsx` | ✅ ALIGNED (Wave 3 — verified no-op) |
| Credentials | `learn/learn-credentials-hub.tsx` | ⏳ Wave 4 (in-flight) |
| Settings | `account/*settings*` | ⏳ Wave 5 (in-flight) |
| CourseDetail | `app/(learn/)courses/[slug]` | existing surface — not net-new |
| Billing | `app/account/billing` | existing |
| Builder / Studio | `teach/builder`, `teacher/course-builder-studio` | existing |
| Community | `app/learn/community` | existing |
| Payouts | `app/fees-and-payouts` | existing |
| Wishlist | `app/learn/wishlist` | existing |
| Agenda | `learn/learn-events-hub` | existing (events) |
| LessonUploadModal | teach upload flow | existing |
| **Paths** | none | ⛔ DEFERRED net-new (D3) |
| **Messages** | none | ⛔ DEFERRED net-new (D3) |
| **Affiliate** | none | ⛔ DEFERRED net-new (D3) |
| **Tutorial** | none | ⛔ DEFERRED net-new (D3) |
| **ReviewsModeration** | partial (`learn/course-review-panel`) | ⛔ DEFERRED dashboard (D4) |

## Deferred net-new — what each would require (do NOT port the mock blind)

1. **Learning Paths** (`Paths.jsx`) — an ordered, curated sequence of courses with its own progress rollup.
   Prereq: a `paths` + `path_items` schema, an enrollment/progress rollup across member courses, an authoring UI for whoever curates a path. The mock's "recommended path" and completion % are fabricated. **Product decision first (D3).**
2. **Messages / DMs** (`Messages.jsx`) — 1:1 and cohort messaging.
   Prereq: `conversations`/`messages` tables + RLS, realtime channel, moderation/report, notification hooks, abuse/rate-limit. Non-trivial backend. The mock's threads are fake. **Product + trust/safety decision (D3).**
3. **Affiliate** (`Affiliate.jsx`) — referral links, attribution, commission payouts.
   Prereq: referral-code issuance, attribution tracking, commission ledger, integration with the existing Stripe Connect payout rails, tax/1099 considerations. The mock's earnings/clicks are fabricated. **Business + finance decision (D3).**
4. **Tutorial tour** (`Tutorial.jsx`) — first-run coach-mark overlay.
   Prereq: a tour framework + per-user "seen" state; content authored per surface. Low backend, but a real feature with copy to write. Lower risk than 1–3, still a scoped build, not a design port. **D3 (nice-to-have).**
5. **AI sidebar** (gap-map item; no clean mock screen) — an in-classroom AI assistant panel.
   Prereq: AI backend wiring, context plumbing, cost controls, guardrails. **D3.**
6. **ReviewsModeration dashboard** (`ReviewsModeration.jsx`) — a review sits partial: submit/display exists (`course-review-panel`), but a full moderation queue (approve/hide/report triage) does not.
   Prereq: moderation state on reviews + an ops/creator queue UI. Coordinate with the refunds/ops surfaces. **D4 (coordinate).**

## Rejected (do NOT build)

- **study-buddies / live-presence / "N learners online"** — pure fabricated engagement in the mock with no data source. Building it means inventing numbers → violates No-Invention. **REJECTED, not deferred.**
- **`membros/` dark-warm theme variant (D2)** — the handoff ships a PT-BR sample area in a warm-dark palette. Founder decision on record: **palette stays navy `#1a365d` + red `#b22234`**; the warm-dark theme is not adopted. `membros/` remains a sample only. **REJECTED per founder.**

## HELD (founder opt-in, from the foundation commit `c0251f8`)

The handoff `tokens.css` softens four border/surface values — surface-soft `#eef4fc→#f5f9ff`, surface-strong `#e3eef9→#ebf3fb`, `--color-line` `.28→.12`, `--color-line-strong` `.40→.18` — and darkens `--color-ink-muted` `#5a6a81→#7a8fae`. **Not applied**: the `.28/.40` border weight was a documented deliberate fix ("faint = washed out"), the Jun-30 audit concluded tokens already match, and `ink-muted #7a8fae` fails WCAG AA on light surfaces. Left as a one-line opt-in for Patrick, not a blind port.

## Open decisions (status)

| ID | Decision | Recommendation | Status |
|---|---|---|---|
| D1 | Role switcher (route-based vs in-app) | keep route-based | recommend, unchanged |
| D2 | `membros/` PT-BR dark-warm variant | keep navy / English | **rejected** (above) |
| D3 | Net-new features (Paths/Messages/Affiliate/Tutorial/AI) | defer to product | **deferred** (above) |
| D4 | Reviews/refunds moderation dashboard | coordinate w/ ops surfaces | deferred |
