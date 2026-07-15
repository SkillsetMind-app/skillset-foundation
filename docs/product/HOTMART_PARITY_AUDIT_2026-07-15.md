# Hotmart Parity Audit - SkillsetMind

**Date:** 2026-07-15
**Scope:** Creator product creation, subscriptions, offers, sales, receivables, reports, member area, commercial pages, and platform architecture.

## Executive finding

SkillsetMind is not missing recurring checkout. It is missing a coherent recurring-commerce operating model. Monthly/yearly Stripe Checkout, subscription persistence, learner cancellation, payout ledger updates, a course manager, sales views, insights, and a wallet already exist. The product creation entry point hides recurring formats, renewals do not become the same financial facts as one-time orders, and creators cannot operate subscribers or subscription refunds from a dedicated workspace.

## Evidence reviewed

- Both attached Hotmart mapping/specification documents.
- Seven Markdown documents in `C:/Users/nicae/PS8-OS/03-projetos/skillsetmind`.
- Archived authenticated Hotmart captures for producer home, product overview, basic data, pricing/offers, promotional links, member area, and product page.
- Detailed capture series for refund window, one-time/custom installment mode, personal verification, declarations, member-area banner/avatar/covers/list/gallery, and learner/producer context switching.
- `Skillset USA - A premium learning marketplace.pdf` (learner marketplace/faculty reference).
- Previous Claude sessions and product decision notes.
- Canonical codebase, generated Supabase types, migrations, Stripe routes, webhooks, data mappers, and 168-test baseline.

Screenshots containing personal or SSO data were inspected but not copied, quoted, or committed.

## Capability matrix

| Capability | Current state | Verified gap | Priority |
|---|---|---|---|
| Product creation | Course draft exists | Entry point only exposed one-time/free; subscription was hidden | P0 fixed in issue #4 |
| Recurring checkout | Monthly/yearly Stripe Checkout exists | Creation and creator operations were incoherent | P0/P1 |
| Recurring financial facts | Subscription mirror and payout ledger update | Renewals do not create the order/payment facts used by sales reports | P0 |
| Refunds | One-time request/admin paths exist | Learner request excludes subscription source and recurring invoices lack compatible order facts | P0 |
| Schema/RPC reproducibility | Generated types describe current remote schema | Migrations create 5 tables while types describe 42; 14/23 called RPCs are unversioned | P0 |
| Order authorization/detail | Orders table contains creator/financial columns | Client mapper discarded creator, refund, receipt, payout, and date fields | P0 fixed in issue #4 |
| Offers | One price/payment model per course | No Offer entity, simultaneous monthly+annual options, trial, code, or immutable terms snapshot | P1 |
| Subscription management | Learner cancellation exists | No creator subscriber center, status operations, dunning/recovery, or renewal history | P1 |
| Sales and analytics | Sales list, insights, wallet exist | Orders-only reports, 500-row client limit, no MRR/churn/LTV/renewal reporting | P1 |
| Receivables | Payout ledger/release process exists | Global transparency and canonical reconciliation remain incomplete | P1 |
| Coupons/affiliates/co-production/tax | Configuration surfaces exist | Not executed through checkout, webhook, or settlement | P2 |
| Commercial links/pages | Product/manage surfaces exist | No offer-driven sales-page editor, QR/widget system, or complete funnel operation | P2 |
| Member area | Strong existing customization/content flow | Remaining workflow refinements, search/resume/list-grid integration | P2 |
| AI advisor | Partial assistant surfaces | Not grounded in creator product/sales/knowledge data | P3 |

## Product model decisions

1. **Product format and offer are different concepts.** Course, subscription, and free describe delivery/access. Amount, currency, interval, trial, guarantee, billing count, and public code belong to offers.
2. **Creator SaaS billing and learner subscriptions are different domains.** They must not share entities, reports, labels, or cancellation rules.
3. **Creation remains short.** Format and basics create a draft; paid products continue in Pricing and free products continue in Curriculum.
4. **Money-path integrity precedes breadth.** A renewal must be visible, refundable, reconcilable, and auditable before adding more commercial controls.
5. **Hotmart is an information-architecture benchmark, not a UI clone.** SkillsetMind keeps its practitioner-grade visual system and only imports proven workflow structure.

## Recommended architecture

### Canonical commerce entities

- `products`: delivery format, creator, publication and access semantics.
- `offers`: public code, product, status, commercial policy.
- `prices`: currency, amount, one-time/recurring, interval and interval count.
- `subscriptions`: learner, product/offer/price, provider IDs, status, periods, cancellation and delinquency.
- `financial_transactions`: canonical charge/invoice/refund/dispute/reversal facts.
- `payout_ledger`: creator settlement derived from immutable financial facts.

Existing course-level pricing should be migrated through a compatibility adapter rather than removed in one release.

### Event invariant

Every Stripe event is handled idempotently and links provider event, invoice/charge, learner, creator, product, offer, currency, gross, fees, net, refund, dispute, payout state, and audit record. Creator reports read these facts; they do not infer revenue from enrollment state.

## Execution order

1. Version the full Supabase schema/RPC baseline and fix current mapping defects.
2. Materialize recurring invoices as canonical sale/payment facts and complete subscription refunds.
3. Add creator subscriber management and recurring metrics.
4. Introduce product/offers/prices and move checkout to offer resolution.
5. Build global sales, receivables, wallet transparency, reports, and exports.
6. Execute coupon, affiliate, co-producer, and tax policies in the money path.
7. Complete commercial links/pages, member refinements, automations, and grounded AI.

## Risks

- Implementing advanced offer UI before canonical financial facts would produce controls that cannot be reconciled.
- Treating enrollment as the source of revenue truth hides renewals and breaks refund/accounting behavior.
- Treating subscription as merely a payment card under a course prevents plan lifecycle and multi-price operation.
- Copying all Hotmart navigation before backend behavior exists would expose dead-end product surfaces.
- Remote-schema drift remains the largest deployment/recovery risk until migrations and RPC definitions are versioned.
