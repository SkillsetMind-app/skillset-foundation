# Platform Design Alignment — v2.2 "claude design" standard

> Local plan (NOT committed — docs/ stays out of git; repo is public).
> Created 2026-06-25. Owner: autonomous execution per user mandate.
> Goal: bring every internal surface to the v2.2 standard — simpler scope
> (respect intentional feature cuts) + stronger desktop structure (dividers,
> lines, clear sections). Page by page, gate per commit, never push.

## Why
The home/marketing surfaces already follow v2.2. The 46 app surfaces still use
the OLD generation (`rounded-[4px]`, flat panels, no dividers) which (a) looks
unstructured on desktop and (b) carries features the claude-design intentionally
removed to ship faster. Storefront + account-hub are the live gold standard.

## The v2.2 Alignment Contract (apply to every surface)

1. **Card generation**
   - Settings/form panels → `settings-section-card` (the account-hub/storefront pattern).
   - Content/metric cards → `rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]`, hover `-translate-y-0.5` + `shadow-strong`.
   - Hero/feature blocks → `rounded-[18px]` + accent top bar.
   - NO `rounded-[4px]` flat panels.

2. **Section heads (every major block)**
   - Eyebrow: `text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]`.
   - Heading: `display-title` (Cormorant) at the section scale.
   - Mirrors reference `.eyebrow + h2` / `.sec-head`.

3. **Desktop structure — the user's key point ("sem divisória, sem linha")**
   - Lists/rows: `divide-y divide-[var(--color-line)]`.
   - Sub-section separators: `my-5 h-px bg-[var(--color-line)]` (reference charter/Studio pattern).
   - KPI/metric rows: bordered cards in a grid, not bare numbers.
   - Clear section boundaries; generous, consistent spacing.

4. **Inputs / controls**
   - Input: `rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--color-primary-light)]`.
   - Toggle: `settings-toggle`. Buttons: `button-solid` / `button-outline` / `button-solid-light` (on navy).
   - Error: `info-notice`-style crimson banner. Success: `info-notice`.

5. **Tokens only (dark-mode safe)** — no hardcoded `#fff`/grays; use `var(--color-*)`.

6. **Reduction principle (scope cut)**
   - If the v2.2 reference for a surface omits a feature the live page has,
     treat it as an INTENTIONAL cut: simplify/hide, don't expand.
   - Flag every cut in the commit body so it's reviewable/reversible.
   - NEVER invent or re-add a removed feature.

7. **Copy** — humanized, no AI tells (carry the Hormozi/home voice). Don't bloat.

## Gate (per surface)
`npx eslint <files>` + `npx tsc --noEmit` + `npm run build` all green →
ONE commit per surface/cluster (`refactor(design): …`) → next.
Never stage `docs/` or `.claude/`. Never `git push` (devops-only).

## Execution queue (page by page)

### Wave 1 — Teacher (named first)
1. **teach dashboard** — `teacher-studio-dashboard.tsx` (ref: Studio.jsx) ← START
2. **builder** — `course-builder-studio.tsx`, `app/teach/builder/page.tsx`, `…/[courseId]/preview/page.tsx` (ref: Builder.jsx)
3. **sales** — `sale-list.tsx`, `sale-detail.tsx`
4. **events** — `teacher-event-studio.tsx`
5. **media** — `teacher-media-library.tsx`, `course-asset-uploader.tsx`
6. **connect/onboarding** — `teacher-connect-onboarding.tsx`, `course-preview-shell.tsx`
   (storefront ✅ done)

### Wave 2 — Learn
7. `learn-dashboard.tsx`, `learner-overview-metrics.tsx`
8. `enrolled-course-workspace.tsx`, `creator-course-workspace.tsx`
9. community: `course-community-feed.tsx`, `creator-course-community.tsx`, `learn-community-hub.tsx`, `community-leaderboard.tsx`, `app/learn/community/creator/page.tsx`
10. `learn-credentials-hub.tsx` (ref: Credentials.jsx), `learn-events-hub.tsx`
11. `app/learn/courses/[slug]/page.tsx`, `app/learn/courses/creator/page.tsx`

### Wave 3 — Account
12. `profile-settings-panel.tsx`, `security-settings-panel.tsx`, `account-data-panel.tsx`
13. `plans-panel.tsx`, `billing-tabs.tsx`, `embedded-checkout-panel.tsx`, `app/account/billing/{return,upgrade}/page.tsx`

### Wave 4 — Admin / Ops
14. `ops-dashboard.tsx`, `ops-overview-metrics.tsx`, `app/ops/page.tsx`
15. `managed-course-panel.tsx`, `course-review-queue.tsx`, `admin-enrollment-panel.tsx`
16. `payment-operations-panel.tsx`, `support-ticket-queue.tsx`, `user-lookup-panel.tsx`, `community-moderation-queue.tsx`, `account-action-requests-panel.tsx`

### Wave 5 — Platform / shared
17. `notification-bell.tsx`, `help-bubble.tsx`, `certificate-document.tsx`

## Status
- ✅ Wave 1 (Teacher): media-library, sale-list, sale-detail, event-studio, asset-uploader (commit aff7fa4); course-builder-studio (commit e04463f). Dashboard already aligned; storefront done pre-plan. SKIPped: builder/page, preview/page, course-preview-shell, connect-onboarding (ephemeral/embed only).
- ✅ Wave 2 (Learn): 13 files (commit 21b8e87). Cuts kept reduced (no cohort/cert re-add).
- ✅ Wave 3 (Account): 8 files (commit 7d33255).
- ✅ Wave 4 (Admin/Ops) + Wave 5 (Platform): 13 files (commit b5e97b1). Certificate document left untouched (formal artifact).
- ✅ Wave 6 (cleanup sweep): 15 files (commit 1fb6da0) — courses, support, certificate verification, instructors, shared, error/404/platform/courses pages, teacher preview/builder.
- ✅ DONE: full-src verified — zero rounded-[4px] panels / --color-brand eyebrows remain. Only 4 intentional cases left (builder checkbox, rating stars, decorative separator, certificate document).
- ✅ storefront, home hero+copy (pre-plan)
