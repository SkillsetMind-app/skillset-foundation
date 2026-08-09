# Requirements: SkillsetMind Launch

**Updated:** 2026-07-15
**Core value:** The practitioner owns the audience, data, and commercial relationship; financial behavior must be auditable and predictable.

## Completed

### Hybrid video

- [x] **VID-01..VID-07:** Explicit YouTube/upload source, compatible persistence, playback, and creator UX.

## Phase 2 - Commerce integrity

- [x] **COM-01:** Creation exposes course, subscription, and free as distinct product formats.
- [x] **COM-02:** Subscription creation supports monthly/yearly interval and routes paid products to pricing.
- [x] **COM-03:** Order mapping preserves creator ownership and all available financial detail fields.
- [ ] **COM-04:** Versioned Supabase migrations reproduce the current schema and every RPC called by `src/`.
- [x] **SUB-01:** Each recurring invoice produces an idempotent sale/payment fact and payout-ledger entry.
- [x] **SUB-02:** Subscription charges support eligible full/partial refund with audit history and payout reversal.
- [ ] **SUB-03:** Creator has a subscriber center with status, period, delinquency, cancellation, and recovery state.
- [ ] **SUB-04:** Reports include recurring revenue, MRR, churn, active subscribers, and renewal history.

## Phase 3 - Products and offers

- [ ] **OFF-01:** Product and offer are separate entities; subscription is a product format, not an offer toggle.
- [ ] **OFF-02:** A product supports multiple simultaneous one-time/monthly/annual offers.
- [ ] **OFF-03:** Offer includes price, currency, interval, trial, refund window, optional billing count, dunning, status, and code.
- [ ] **OFF-04:** Checkout resolves an offer and snapshots its terms without breaking legacy course prices.

## Phase 4 - Creator operations

- [ ] **OPS-01:** Global sales view is separate from the per-product management center.
- [ ] **OPS-02:** Global subscription management supports cancel-at-period-end and recovery operations.
- [ ] **OPS-03:** Analytics exposes sales, recurring revenue, conversion events, and exports without a 500-row client cap.
- [ ] **OPS-04:** Commercial operations use auditable server-side actions and explicit permissions.
- [ ] **WAL-01:** Wallet/receivables expose gross, fees, net, release date, transfer, refund, dispute, and reversal.
- [ ] **WAL-02:** Balance holds and availability rules are predictable and visible.
- [ ] **WAL-03:** Payout reconciliation is based on a canonical financial ledger.

## Phase 5 - Growth engines

- [ ] **GRW-01:** Coupons are validated and applied in checkout and settlement.
- [~] **GRW-02:** ~~Affiliate attribution affects settlement and reporting.~~ **Revoked** with the move to Stripe Connect direct charges. Paying an affiliate means paying a third party out of the buyer's payment, which requires the platform to receive the money first. It does not.
- [~] **GRW-03:** ~~Co-producer splits affect payout ledger entries.~~ **Revoked**, same reason as GRW-02. A ledger entry can only record a split the platform actually performs.
- [ ] **GRW-02b:** Upsell/downsell offers execute in the money path. (Took GRW-02's slot in Phase 5: it raises order value without the platform ever holding the money.)
- [ ] **GRW-04:** Tax configuration affects checkout totals and records.
- [ ] **GRW-05:** Commercial links, QR code, widget, sales pages, and automations use real offers.

## Phase 6 - Relaunch experience

- [ ] **EXP-01:** Creator advisor is grounded in current product, sales, and knowledge data.
- [ ] **EXP-02:** Messages and creator onboarding are complete.
- [ ] **EXP-03:** Creator navigation exposes only functional operational surfaces.
- [ ] **EXP-04:** Member-area content/customization workflow is complete and tested.
- [ ] **EXP-05:** Creator storefront and per-course learning area remain distinct surfaces.

## Out of scope for this milestone

| Feature | Reason |
|---|---|
| HIPAA clinical therapy workflow | Separate regulated product decision |
| 1:1 coaching marketplace | Post-launch vertical after course commerce is reliable |
| Manual moderation as the default | Conflicts with solo-founder automation requirement |
