# Roadmap: SkillsetMind Launch

## Overview

The launch program follows the verified state of the code rather than the older research roadmap. Hybrid video is complete (Phase 1). Commerce integrity (Phase 2) was paused on 2026-07-15 with COM-01..03 and SUB-01..02 shipped. Milestone v1.1 (phases 7-12, opened 2026-09-07 on issue #243) runs a screen-by-screen parity pass against Hotmart and turns the gaps into one PR per flow, starting with archive/delete course. Phases 2-6 resume after v1.1.

## Phases

**Phase numbering:** integer phases are planned milestone work; decimal phases are urgent insertions.

- [x] **Phase 1: Hybrid video** - explicit source selection and compatible playback.
- [ ] **Phase 2: Commerce integrity** - reproducible schema/RPC baseline, trustworthy order mapping, recurring financial facts, refunds, and subscription creation. (paused 2026-07-15)
- [ ] **Phase 3: Products and offers** - product formats plus multiple independent offers/prices, trials, guarantees, currencies, and offer-driven checkout.
- [ ] **Phase 4: Creator operations** - global sales and subscription management, receivables, wallet transparency, MRR/churn/LTV, and exports.
- [ ] **Phase 5: Growth engines** - coupons, upsell/downsell, taxes, commercial links, pages, and automations executed in the money path. (Affiliates and co-producers were dropped here: both pay a third party out of the sale, and under direct charges the sale never lands in a SkillsetMind balance to split.)
- [ ] **Phase 6: Relaunch experience** - creator advisor, messages, onboarding, navigation, member-area refinements, storefront, and contextual AI.
- [x] **Phase 7: Parity checklist (F0)** - closed 91-row checklist built from the July menu map, the September design comparison and the 34 existing captures.
- [ ] **Phase 8: Hotmart extraction (F1)** - every checklist row visited on Hotmart, read-only: desktop 1440, mobile 390, full page, destination of every button.
- [ ] **Phase 9: SkillsetMind extraction (F2)** - same checklist, same numbering, on production logged in as the founder (admin + teacher), plus learner and public screens.
- [ ] **Phase 10: Comparison matrix (F3)** - per row: equal / adopt / adapt / skip, with measurements and an order by value.
- [ ] **Phase 11: Parity PRs (F4)** - one PR per flow, house pattern, starting with archive/delete course.
- [ ] **Phase 12: Final logged-in QA (F5)** - founder signs off in the visible browser.

## Phase Details

### Phase 1: Hybrid video

**Goal:** Let creators explicitly choose YouTube or native upload while preserving legacy lesson behavior.

**Status:** Complete on issue #2 / PR #3.

### Phase 2: Commerce integrity

**Goal:** A creator can start a subscription product and trust that every initial payment, renewal, refund, and payout is represented consistently across authorization, sales, and reporting.

**Depends on:** Phase 1 only because this branch is stacked on PR #3; the commerce code itself is independent.

**Requirements:** COM-01..COM-04, SUB-01..SUB-04

**Success Criteria:**

1. Product creation exposes course, subscription, and free formats; subscriptions support monthly/yearly interval before pricing.
2. Order mapping preserves creator ownership, refund, receipt, payout model, and lifecycle timestamps.
3. Versioned migrations can reproduce every table/RPC required by the application.
4. Every recurring invoice creates a first-class financial fact visible in creator sales and revenue.
5. Eligible subscription charges can be refunded without depending on one-time-order assumptions.
6. Creators can view subscriber status, current period, scheduled cancellation, delinquency, and recovery.

### Phase 3: Products and offers

**Goal:** Separate the product being delivered from the commercial offers used to sell it.

**Requirements:** OFF-01..OFF-04

**Success Criteria:**

1. A product can have multiple active offers, including monthly and annual prices at the same time.
2. Offers carry amount, currency, billing interval, trial, refund window, optional billing count, dunning policy, and public code.
3. Checkout resolves a validated offer and snapshots its commercial terms.
4. Existing course-level prices remain compatible during migration.

### Phase 4: Creator operations

**Goal:** Give practitioners a global operational workspace across products.

**Requirements:** OPS-01..OPS-04, WAL-01..WAL-03

**Success Criteria:**

1. Separate global views exist for sales, subscriptions, receivables, and analytics.
2. Subscription controls support cancel-at-period-end and recovery actions with audit history.
3. Wallet shows gross, fees, net, availability date, payout, refund, dispute, and reversal.
4. Reports expose MRR, churn, active/past-due/cancelled subscribers, LTV, and CSV export.

### Phase 5: Growth engines

**Goal:** Make currently decorative commercial settings participate in checkout, webhook, and payout calculations.

**Requirements:** GRW-01..GRW-05

### Phase 6: Relaunch experience

**Goal:** Complete high-value creator and learner workflows after the money path is reliable.

**Requirements:** EXP-01..EXP-05

### Phase 7: Parity checklist (F0)

**Goal:** A closed list of everything that must be seen, so coverage can be counted.

**Depends on:** Nothing.

**Requirements:** PAR-01

**Success Criteria** (what must be TRUE):
1. Every item of the Hotmart producer menu (7 groups, 30 items), every course-center tab (11 + header actions), every Club menu item (12), every learner screen and every commercial flow has its own row.
2. Each row says what the 34 existing captures already cover (full, partial, none) and at what width.
3. The five holes no capture answers are named (delete/deactivate product, producer panel on mobile, product panel checklist, real public page and checkout, any full-page capture).

**Status:** Complete 2026-09-07 (`paridade-v2/CHECKLIST-F0-2026-09-07.md`, private vault): 91 rows + 2 cross-cutting; 19 rows covered, 25 partial, 47 without capture.

### Phase 8: Hotmart extraction (F1)

**Goal:** Every row of the checklist visited on Hotmart with proof, read-only.

**Depends on:** Phase 7; a connected browser logged into the founder's Hotmart account (founder logs in; the agent never types credentials).

**Requirements:** PAR-02

**Success Criteria** (what must be TRUE):
1. For each row: visited, desktop 1440 capture, mobile 390 capture, full-page capture, real destination URL, list of buttons and where each leads, or an explicit `BLOQUEADO: reason`.
2. Row C04 (delete/deactivate product) answers where it lives, its exact label, what the confirmation says, and whether a product with sales can only be deactivated, without confirming any deletion.
3. Zero write actions on Hotmart: no purchase, post, comment, upload, campaign, page, coupon, class, contact, term acceptance, setting change or withdrawal request.
4. Captures live outside the repo; per-row notes live in the private vault under `paridade-v2/hotmart/`.

**Plans:** 1 plan (extraction agent run, sequential in the connected window).

### Phase 9: SkillsetMind extraction (F2)

**Goal:** The same checklist filled for SkillsetMind, same numbering and naming, so rows can be compared side by side.

**Depends on:** Phase 7; a connected browser logged into production as the founder (admin + teacher).

**Requirements:** PAR-03

**Success Criteria** (what must be TRUE):
1. Same columns as Phase 8 for every row; rows with no SkillsetMind equivalent say `NÃO EXISTE`; empty states caused by empty production data say `vazio em produção`.
2. Row C04 answers where the teacher and the admin can delete or archive a course today, and what each path allows (draft only, published, with sales).
3. Zero write actions on production: no publish, delete, purchase, message, setting change or product creation.

**Plans:** 1 plan (extraction agent run).

### Phase 10: Comparison matrix (F3)

**Goal:** A decision per row and an order of work.

**Depends on:** Phases 8 and 9.

**Requirements:** PAR-04

**Success Criteria** (what must be TRUE):
1. Every row has a verdict: already equal / adopt / adapt / skip, with the reason in one line.
2. Adopt/adapt rows carry measurements (spacing, hierarchy, tap targets, mobile behavior) taken from the captures, not from memory.
3. Founder decisions are preserved (dark members area, optimistic publishing, no affiliates, no gamification, no cross-sell in the classroom, no own checkout, no creator color customization).
4. The list is ordered by value and each item names the files it touches.
5. Surfaces that exist only on SkillsetMind (Online events with agenda is the first named) are not compared but receive the house pattern distilled from the adopted rows, so they stop looking raw next to the refined pages (founder direction 2026-09-08).

**Plans:** 1 plan (session-owner analysis; no agent).

### Phase 11: Parity PRs (F4)

**Goal:** Close the gaps, one PR per flow, without breaking what already works.

**Depends on:** Phase 10 for the order; Phase 8 row C04 for the first PR.

**Requirements:** PAR-05, PAR-06

**Success Criteria** (what must be TRUE):
1. First PR: the teacher can archive (unpublish) a published course and the admin can delete any course from a discoverable place in the UI; drafts keep the existing delete path; the rule for courses with enrollments mirrors Hotmart's deactivate-instead-of-delete behavior as confirmed in Phase 8.
2. Every PR follows the house pattern: PT-BR title "fix/feat: what the person suffered", body sofria/muda/fora/prova, proof by reversal, tsc and eslint clean, draft promoted so the Porteiro runs, squash merge, visual QA at 390/768/1440.
3. Every PR is reviewed by the session owner before merge; tests run one vitest file at a time.

**Plans:** TBD (one per flow, ordered by Phase 10).

Plans:
- [ ] 11-01: archive/delete course (teacher archive + admin delete, discoverable UI).
- [ ] 11-02..: top of the Phase 10 list.

### Phase 12: Final logged-in QA (F5)

**Goal:** The founder confirms in the visible browser that each merged flow matches the decision taken in Phase 10.

**Depends on:** Phase 11.

**Requirements:** PAR-07

**Success Criteria** (what must be TRUE):
1. Each Phase 11 PR has a founder check on desktop and mobile.
2. Remaining differences are listed as skip-with-reason or as new backlog rows, never left implicit.

## Progress

| Phase | Status | Completed |
|---|---|---|
| 1. Hybrid video | Complete | 2026-07-15 |
| 2. Commerce integrity | Paused (resumes after v1.1) | - |
| 3. Products and offers | Not started | - |
| 4. Creator operations | Not started | - |
| 5. Growth engines | Not started | - |
| 6. Relaunch experience | Not started | - |
| 7. Parity checklist (F0) | Complete | 2026-09-07 |
| 8. Hotmart extraction (F1) | Waiting for Hotmart login in the connected browser | - |
| 9. SkillsetMind extraction (F2) | In progress | - |
| 10. Comparison matrix (F3) | Not started | - |
| 11. Parity PRs (F4) | Not started | - |
| 12. Final logged-in QA (F5) | Not started | - |
