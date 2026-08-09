# Roadmap: SkillsetMind Launch

## Overview

The launch program now follows the verified state of the code rather than the older research roadmap. Hybrid video is complete. Recurring Stripe Checkout and learner cancellation already exist, so the commerce work starts with integrity and creator operations instead of rebuilding checkout.

## Phases

- [x] **Phase 1: Hybrid video** - explicit source selection and compatible playback.
- [ ] **Phase 2: Commerce integrity** - reproducible schema/RPC baseline, trustworthy order mapping, recurring financial facts, refunds, and subscription creation.
- [ ] **Phase 3: Products and offers** - product formats plus multiple independent offers/prices, trials, guarantees, currencies, and offer-driven checkout.
- [ ] **Phase 4: Creator operations** - global sales and subscription management, receivables, wallet transparency, MRR/churn/LTV, and exports.
- [ ] **Phase 5: Growth engines** - coupons, upsell/downsell, taxes, commercial links, pages, and automations executed in the money path. (Affiliates and co-producers were dropped here: both pay a third party out of the sale, and under direct charges the sale never lands in a SkillsetMind balance to split.)
- [ ] **Phase 6: Relaunch experience** - creator advisor, messages, onboarding, navigation, member-area refinements, storefront, and contextual AI.

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

## Progress

| Phase | Status | Completed |
|---|---|---|
| 1. Hybrid video | Complete | 2026-07-15 |
| 2. Commerce integrity | In progress | - |
| 3. Products and offers | Not started | - |
| 4. Creator operations | Not started | - |
| 5. Growth engines | Not started | - |
| 6. Relaunch experience | Not started | - |
