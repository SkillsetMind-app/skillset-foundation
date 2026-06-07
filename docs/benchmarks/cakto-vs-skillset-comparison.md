---
type: competitive-comparison
benchmark: Cakto (BR checkout/infoproduct platform)
target: SkillsetUSA (skillset-foundation)
source_dossier: docs/benchmarks/cakto-reference-dossier.md
generated: 2026-05-31
method: file-level verification against repo (git main) — Article IV No-Invention enforced
status: draft for founder review
---

# Cakto → SkillsetUSA — Competitive Design Comparison

> **What this is.** The output of the master prompt in `comparison-master-prompt.md`, run inside the session that holds the `skillset-foundation` context. It compares **Cakto** (the "selling machine" benchmark captured frame-by-frame in `cakto-reference-dossier.md`) against **SkillsetUSA**, dimension by dimension, and turns the gaps into prioritized, buildable work.
>
> **Grounding (Article IV — No Invention).** Every SkillsetUSA claim below was verified against a real file in this repo (path cited). Where the source dossier's mapping matrix was **wrong**, this document corrects it — that correction is the whole point of running the verification rather than trusting the matrix. Verdicts: ✅ real / 🟡 partial / ❌ missing-or-stub.

---

## 1. Executive summary — the 5 biggest findings

1. **SkillsetUSA's payment *spine* is genuinely strong — stronger than the demo surface suggests.** Stripe Connect embedded onboarding (`teacher-connect-onboarding.tsx`), a real payout ledger with hold/release (`teacher-wallet-panel.tsx` + `functions/src/payment-rules.ts` + `dailyReleaseTransfers` in `functions/src/index.ts`), course checkout (`createCheckoutSession`), and plan-subscription checkout (`embedded-checkout-panel.tsx`) are all built. This is the hard part, and it's done.

2. **What's missing is the entire "conversion layer" — the exact thing Cakto exists to do.** Verified absent in code (grep across `src/` + `functions/`): **Order Bump ❌, Upsell/Downsell ❌, Affiliate program ❌.** These are the highest-AOV / highest-acquisition levers and none of them exist.

3. **Four Teacher-Studio nav routes are "coming soon" stubs, reachable in a live demo.** `/teach/coupons`, `/teach/co-productions`, `/teach/integrations`, `/teach/team` all render `<TeacherComingSoonPanel>`. The dossier over-credited two of these (coupons + co-productions marked ✅). For an investor walkthrough this is the #1 cheap fix: hide or relabel them so the platform doesn't look half-finished.

4. **A copy↔product mismatch is live on the marketing site.** `src/app/promise/page.tsx:17` promises "**affiliate tools**, community, analytics, quizzes, certificates, drip, custom domains … on every plan." Affiliate tooling is confirmed **not built**. The site is currently writing checks the product can't cash — worth aligning before the demo.

5. **Teacher analytics is shallow vs Cakto's "Relatórios."** `teacher-studio-insights.tsx` ships a clean monthly revenue chart + top-courses + next-payout estimate, but has **no LTV, churn, cart-abandonment, refund-rate, or revenue-by-product/affiliate**. `functions/src/course-analytics.ts` is *not* a reporting module — it only builds the `course_published` PostHog funnel event. Reporting depth is a real 🟡.

---

## 2. Comparison matrix

> Legend: ✅ real & shipped · 🟡 partial · ❌ missing or "coming soon" stub. **Δ** flags where this verification corrected the source dossier.

### D1 — Visual design

| Element | Cakto | SkillsetUSA (file) | Verdict | Note |
|---|---|---|---|---|
| SaaS shell: collapsible sidebar + topbar | Yes | `platform-shell.tsx`, `platform-nav.tsx`, `platform-header.tsx`, `sidebar-toggle.tsx`, `mobile-sidebar-drawer.tsx` | ✅ | Full parity, incl. mobile drawer + `notification-bell.tsx`. |
| Dark/light theme toggle | Yes (topbar) | `shared/theme-toggle.tsx` | ✅ | — |
| Status badges | "Ativo" chips | `shared/status-chip.tsx` | ✅ | — |
| High-density "financial panel" aesthetic | Yes | `teacher-studio-dashboard.tsx` | ✅ | Comparable card/table density. |

### D2 — UX / frontend patterns

| Pattern | Cakto | SkillsetUSA (file) | Verdict | Note |
|---|---|---|---|---|
| Horizontal tabs (product editor) | 10 tabs | `shared/horizontal-tabs.tsx` | ✅ | Primitive exists; SkillsetUSA's builder uses fewer tabs (it has fewer monetization features to tab between). |
| Period/dashboard filters | Today/7/30/Always | `shared/dashboard-filters.tsx`; revenue ranges 3m/6m/12m/all in `teacher-studio-insights.tsx:24-31` | ✅ | — |
| Floating help widget | Support/Suggest/Bug | `platform/help-bubble.tsx` | ✅ | — |
| Account menu + dual-role switch | "switch to student panel" | `site/account-menu.tsx` | ✅ | Confirm the role-switch action is wired (existence ✅). |
| Table export | Export buttons | `shared/export-table-button.tsx` | ✅ | — |
| **Live preview inside offer modals** | Order-bump/upsell render live | — | ❌ | No offer-config modals exist to preview (the features they'd configure don't exist). |
| **In-app NPS popup** | 1–5 rating | — | ❌ | No equivalent. Low priority. |

### D3 — Features / backend capability

| Capability | Cakto | SkillsetUSA (file) | Verdict | Note |
|---|---|---|---|---|
| Sales dashboard | Cards + payment-method table | `teacher-studio-dashboard.tsx`, `teacher-overview-metrics.tsx` | ✅ | Strong. |
| Sales list + detail | Tabs Approved/Refunded/Chargeback | `sale-list.tsx`, `sale-detail.tsx`, `/teach/sales/[orderId]` | ✅ | Real. `sale-detail.tsx:341` has one sub-feature chipped "Coming soon". |
| Refund handling | Yes | `/teach/refunds/page.tsx`, `automaticRefundWindowDays=7` in `payment-rules.ts` | ✅ | Refund route is real (not a stub). |
| Course builder / "add product" | Wizard + 10-tab editor | `create-course-start.tsx`, `course-builder-studio.tsx`, `teacher-course-studio.tsx`, `/teach/builder` | ✅ | Real and deep. Course pricing = one-time + free only; **subscription pricing is "Coming soon"** (`course-builder-studio.tsx:176-186`). |
| Drip / scheduled release | Implicit | per-lesson delay field (`course-builder-studio.tsx:150-151`) | ✅ | Exists as lesson-level release timing. |
| Course delivery / members area | Cakto Members | `/learn/*`, `enrolled-course-workspace`, `watermarked-video-player` | ✅ | Real; watermarked video is a plus Cakto didn't show. |
| Marketplace / storefront | Vitrine | `courses/course-marketplace.tsx`, `/courses` | ✅ | Real. |
| Plans / subscriptions (platform) | Planos e Taxas | `account/plans-panel.tsx`, `shared/plan-selector-cards.tsx` | ✅ | Real. Commission tiers in `payment-rules.ts`: free 8% / starter 4% / pro 1% / plus 0%. |
| **Reports depth (LTV, churn, by-product, abandonment, by-affiliate)** | Relatórios + Assinaturas | `teacher-studio-insights.tsx` (revenue chart, top courses, net payout only); `course-analytics.ts` = funnel event only | 🟡 | No LTV/churn/abandonment/by-affiliate. Top-courses is a partial "revenue by product." |
| **Conversion pixels (FB/Google/TikTok)** | Per-product pixels | — (PostHog events only; `/teach/integrations` is a stub) | ❌ **Δ** | Dossier said 🟡; the integrations page is "coming soon." No `fbq`/`gtag`/`ttq` anywhere in `src/`. |
| **Coupons** | Dedicated tab | `/teach/coupons/page.tsx` → `<TeacherComingSoonPanel>` | ❌ **Δ** | Dossier said ✅; it's a stub. |
| **Co-production (revenue split)** | Tab + invites | `/teach/co-productions/page.tsx` → `<TeacherComingSoonPanel>` | ❌ **Δ** | Dossier said ✅; stub. Needs "payout-split engine on top of Stripe Connect" (its own copy). |
| **Team / roles** | Equipe | `/teach/team/page.tsx` → `<TeacherComingSoonPanel>` | ❌ | Stub. Single-account studios for now. |
| Webhooks 2.0 | Yes | — (inside integrations stub) | ❌ | Roadmap. |

### D4 — Modals & components

| Component | Cakto | SkillsetUSA | Verdict | Note |
|---|---|---|---|---|
| Add-product wizard w/ inline validation | Yes | `create-course-start.tsx` + builder | ✅ | — |
| Lesson/content modal | — | `teacher/lesson-content-modal.tsx` | ✅ | SkillsetUSA-specific. |
| Date-range calendar picker | Reports | revenue range tabs (3m/6m/12m/all), not a calendar | 🟡 | Range presets, not an arbitrary date picker. |
| **Order Bump modal w/ live preview** | Yes | — | ❌ | — |
| **Upsell generator modal w/ live preview** | Yes | — | ❌ | — |
| Asset uploader (drag-drop) | Product image | `teacher/course-asset-uploader.tsx`, `media-library` | ✅ | — |

### D5 — Monetization flows (the "sell" path)

| Flow step | Cakto | SkillsetUSA (file) | Verdict | Note |
|---|---|---|---|---|
| Public course checkout | `pay.cakto.com.br/{id}` (Pix/Boleto/Card) | `createCheckoutSession` (`functions/src/index.ts`) → Stripe Checkout; model `separate_charges_and_transfers` | ✅ | Stripe/US, not BR rails. **Δ** the dossier mapped checkout to `embedded-checkout-panel.tsx`, but that file is the **plan-subscription** checkout, *not* the course-buy flow. |
| Platform plan subscription | Planos e Taxas | `account/embedded-checkout-panel.tsx` (`createBillingCheckoutClientSecret`) | ✅ | Embedded Stripe; teacher subscribes to free/starter/pro/plus. |
| **Order bump at checkout** | 1 toggle, +AOV | — (grep `order.?bump\|bump`: only in docs) | ❌ | Highest-AOV gap. Anchor = the course-buy flow, not the plan panel. |
| **Upsell/Downsell 1-click post-purchase** | Thank-you page offer | — (grep `upsell\|downsell`: only in docs) | ❌ | Needs saved-PM + off-session charge support in `payment-rules.ts`/`index.ts`. |
| **Affiliate program + affiliate marketplace** | Vitrine de Afiliação | — (grep `affiliate\|afiliad\|referral`: only marketing copy in `promise/page.tsx`) | ❌ | Distinct from co-production. Acquisition engine. |
| Payout hold ("Saldo Reservado") | Reserved balance | `payoutReleaseDelayDays` (`payment-rules.ts`) + `dailyReleaseTransfers` (`index.ts`) | ✅ | **Direct twin.** Resolved 2026-06-06: **30 days** in code (`payoutReleaseDelayDays=30`) and UI (`payoutClearDays=30`); refund window stays 7. |
| KYC / bank details | CPF + bank gate | `teacher-connect-onboarding.tsx` (Stripe Connect) | ✅ | Stripe owns KYC; SkillsetUSA never stores bank details. |
| Withdraw button | "Efetuar Saque" | — (automatic Stripe payout, by design) | ✅ (by design) | No manual-withdraw button — Stripe auto-pays out on schedule. Intentional, not a gap. |

---

## 3. Prioritized recommendations

> Scored on Impact (revenue/retention) × Effort (our stack reality). Story-driven: these are **candidate stories**, not code to start now.

### 🟢 Quick wins (high impact, low effort, fits existing components)

| # | What to build | Files it touches | Effort | Impact | Candidate story |
|---|---|---|---|---|---|
| Q1 | **Hide or relabel the 4 "coming soon" stub routes** in the teacher nav for the investor demo (drop from `platform-nav.tsx`, or tag them "Roadmap" so they read as intentional, not broken). | `platform/platform-nav.tsx` (+ the 4 stub pages stay) | XS | **High (demo credibility)** | `demo-hide-roadmap-routes` |
| Q2 | **Align `/promise` copy with shipped reality** — stop advertising "affiliate tools / community" as on-every-plan features until they exist (or footnote them as roadmap). | `src/app/promise/page.tsx:17` | XS | High (credibility) | `promise-copy-truth-pass` |
| Q3 | **Settle the payout-hold number + fix copy/code mismatch** (10 in code vs "7" in UI). One constant + one copy string. | `functions/src/payment-rules.ts`, the wallet/checkout copy | XS | Medium (trust) | `payout-hold-align` |
| Q4 | **Surface refund-rate + a basic conversion stat on the insights dashboard** — the data is already in `orders`; it's a reduce + a card, no new backend. | `teacher-studio-insights.tsx` (already computes gross/fee/net from `paidOrders`) | S | Medium (closes part of the analytics 🟡) | `insights-refund-rate-card` |
| Q5 | **Order Bump v1 as a pre-checkout add-on toggle** on the course-buy page (offer a second course/asset; pass both as line items / a second charge through `createCheckoutSession`). Stripe Checkout supports multi-line. | course-buy UI + `functions/src/index.ts` (`createCheckoutSession`) | M | **High (AOV)** | `checkout-order-bump-v1` |

### 🔵 Big bets (high impact, high effort — new backend in `functions/`)

| # | What to build | Files / new modules | Effort | Impact | Candidate story/epic |
|---|---|---|---|---|---|
| B1 | **Affiliate program + affiliate marketplace** — commission model, attribution links, affiliate dashboard, split payout via Stripe transfers. Distinct from co-production. | new `functions/src/affiliates.ts`, data model, `/teach/affiliates`, a public affiliate storefront | L | **High (acquisition)** | epic `affiliate-program` |
| B2 | **Upsell/Downsell 1-click post-purchase** — thank-you offer page + off-session charge on the saved PM. | `functions/src/payment-rules.ts` + `index.ts` (off-session `paymentIntents`), new post-purchase route | L | High (AOV) | epic `post-purchase-upsell` |
| B3 | **Co-production payout-split engine** — turn the stub into reality (split a sale across N connected accounts on Stripe). | `/teach/co-productions` + new split logic in `index.ts` transfers | L | Medium (creator acquisition) | epic `co-production-splits` |
| B4 | **Reports depth** — LTV, churn (for plan subs), revenue-by-product, cart-abandonment, by-affiliate. | new `functions/src/reports.ts` + expand `teacher-studio-insights.tsx` | M–L | Medium | `analytics-reports-v2` |
| B5 | **Subscription course pricing** — unlock the two "Coming soon" builder options (monthly/yearly recurring course access). | `course-builder-studio.tsx:170-187` + recurring billing in `functions/` | M | Medium | `course-subscription-pricing` |

### ⚪ Defer
- In-app NPS popup (Cakto §2) — low ROI.
- Teams/roles (`/teach/team` stub) — only when multi-seat studios are demanded.
- Webhooks 2.0 / integrations framework — after the conversion layer pays for itself.
- Arbitrary date-range calendar in reports — range presets are enough for now.

---

## 4. Do **NOT** port (BR-specific — does not transfer to US/Stripe)

| Cakto item | Why not |
|---|---|
| **Pix / Boleto / Pix Automático / "Pix Pay"** | Brazilian rails. SkillsetUSA settles in USD via Stripe; these have no US equivalent. |
| **CPF / CNPJ KYC fields** | BR tax IDs. Stripe Connect already runs US/international KYC in `teacher-connect-onboarding.tsx` — don't rebuild it. |
| **"cakto está processando este pagamento para o vendedor {email}" seller-of-record copy + checkout reCAPTCHA** | Stripe Checkout already handles fraud/seller-of-record framing. |
| **Manual "Efetuar Saque" (withdraw) button** | SkillsetUSA pays out automatically on Stripe's schedule by design — adding a manual withdraw would be a regression, not a feature. |
| **12× installment framing ("12× de R$ 5,17")** | BR consumer-credit convention. US uses Stripe's own installment/affirm rails if ever needed — different model. |

---

## 5. Open questions for the founder

1. **Payout hold number.** ✅ **RESOLVED 2026-06-06:** the "Saldo Reservado" twin (`payoutReleaseDelayDays`) is **30** in code and the UI (`payoutClearDays=30`) — one consistent number. `automaticRefundWindowDays = 7` stays as the refund window.
2. **`/promise` page truthfulness.** It advertises affiliate tools, community, analytics, quizzes, certificates, drip, custom domains "on every plan." Affiliate is confirmed not built. Which of the others are real vs roadmap? (This decides Q2's scope.)
3. **Demo scope for stub routes.** Hide the 4 "coming soon" routes from nav for the investor demo (Q1), or keep them visible as a roadmap signal?
4. **Order Bump shape.** Pre-checkout add-on toggle on the course page (cheaper, works with current Stripe Checkout — Q5), or a richer embedded-checkout custom UI (more control, more work)?
5. **Recurring course pricing.** Subscription course pricing is "Coming soon" today (one-time + free only). In scope before launch, or after?

---

## Method & traceability

- **Verified by reading/grepping** (not assumed): `embedded-checkout-panel.tsx`, `teacher-connect-onboarding.tsx`, `teacher-wallet-panel.tsx`, `payment-rules.ts`, `course-analytics.ts`, `teacher-studio-insights.tsx`, `course-builder-studio.tsx`, `/teach/{co-productions,integrations,team,coupons}/page.tsx`, `promise/page.tsx`; Globs of `platform/`, `shared/`, `teacher/` components and `/teach/**` routes; repo-wide greps for `order bump`, `upsell|downsell`, `affiliate|referral`, conversion pixels, and `ComingSoon`.
- **Dossier corrections (Δ):** coupons ✅→❌ stub; co-productions ✅→❌ stub; integrations 🟡→❌ stub; course checkout file re-anchored from `embedded-checkout-panel.tsx` (plan billing) to `createCheckoutSession` in `functions/src/index.ts` (course purchase).
- **Constraints honored:** story-driven (no code started); no invention (every claim cites a real file); Stripe/Next.js 16/Firebase stack respected; only `aiox-core/projects/skillset-foundation` treated as canonical (OneDrive copy is dead).

*Companion: `docs/benchmarks/cakto-reference-dossier.md` (the Cakto teardown). Source prompt: `docs/benchmarks/comparison-master-prompt.md`.*
