# Design V2 Handoff — Surface Parity Gap Map

> **Date:** 2026-06-30 · **Author:** JARVIS (parallel audit, 3 read-only agents) · **Status:** MAP COMPLETE — awaiting founder pick of first wave
> **Branch:** `feat/niche-comms-and-design-alignment`
> **Handoff bundle:** `Downloads/Skillset DESIGN V2-handoff.zip` (extracted, dated 2026-06-30)
> **Continues:** `docs/plans/2026-06-28-niche-pivot-and-design-alignment.md` Phase 2 ("surface parity audit")

---

## 0. Founder decisions locked (this session)

1. **Map first, then ship by wave.** No blind porting. Founder picks what ships per wave.
2. **Keep the V2 palette as designed.** Navy `#1a365d` + USA red `#b22234`, Cormorant + Manrope.
   Reposition for therapists/coaches **via copy + imagery, not palette**. (Tokens already match —
   `tokens.css` header says *"Mirrors src/app/globals.css"*; a diff confirms identical.)

**Audience (carried from Jun 28 plan):** licensed psychologists, therapists, holistic/alternative
therapists, and personal-development coaches/mentors. The product sells *belonging + extended impact*,
not "income". Voice: warm, plain, unhurried. No growth-bro verbs.

---

## 1. What changed vs. the last reference

The Jun 25 sweep (`2026-06-25-platform-design-alignment.md`) aligned **46 app surfaces** to the
"v2.2" standard using the OLD reference bundle in `docs/design-reference/skillset-design-v2-2/`
(**16 screens**). That work is DONE — cards, borders, section heads, dividers across the app.

**This handoff is bigger.** It adds ~28 files the old reference never had:

- **Net-new feature screens:** `Paths`, `Messages`, `Affiliate`, `ReviewsModeration`, `Tutorial`,
  `Onboarding`, `Agenda` (composer), `Billing` (consolidated), `Wishlist`, `LessonUploadModal`.
- **The entire `membros/` PT-BR members-area variant** (a *second* members design — different
  architecture: standalone app, role toggle, studio customization).
- **Shared primitives:** `CommandK`, `PWABanner`, `ShareWin`, `ShortcutsHelp`, `Skeleton`, `VerifiedBadge`.

**Consequence:** the residual work is NOT re-skinning already-aligned screens. It is (a) **net-new
features** the platform lacks, and (b) **structural redesigns** of a handful of screens whose V2
layout genuinely differs from current.

---

## 2. Shell verdict — the most important structural finding

**Current app shell already matches V2's pattern:** left-sidebar SaaS shell with collapse, via
`src/components/platform/platform-shell.tsx` + `platform-nav.tsx`. **No shell rewrite.**

Shell deltas (all additive):

| Delta | V2 | Current | Effort | Risk |
|---|---|---|---|---|
| Global search palette | `CommandK.jsx` (⌘K across courses/educators/lessons/events/posts) | none | M | low |
| Role switcher UI | explicit learner↔creator toggle in sidebar | role inferred from route (`/learn` vs `/teach`) | M | **med** (touches auth/perms) — **decision needed** |
| Nav badge counts | numbers on Paths/Community | not wired | S | low |
| Tutorial spotlight tour | post-onboarding guided overlay (learner + creator) | none | L | low |

---

## 3. Consolidated gap map

Legend — **Class:** `ALIGNED` (≈done) · `REDESIGN` (exists, layout differs) · `NEW` (no equivalent).

### Shell / Discovery / Marketing-in-app

| V2 screen | Maps to | Class | Key deltas | Effort | Risk |
|---|---|---|---|---|---|
| Sidebar | `platform-nav.tsx` | REDESIGN(minor) | role toggle, badge counts | S–M | med |
| CommandK | — | NEW | global ⌘K search | M | low |
| Discover | `/learn/courses`, `components/courses/course-marketplace.tsx` | REDESIGN | rich sections: Continue learning / Recommended / Learning paths / New / Faculty / Creator CTA (vs flat grid) | M | med |
| CourseDetail | `/courses/[slug]`, `/learn/courses/[slug]` | REDESIGN | right enrollment card, tabs (curriculum/about/instructor/reviews), hero video | M | med |
| Pricing | `/pricing` | ALIGNED? | verify 4 plans + monthly/annual toggle + fees explainer + FAQ | S | low |
| Onboarding | `/onboarding` | REDESIGN | 4-step modal wizard (objective→level→interests→summary) | M | med |
| Auth | `/auth` | REDESIGN | split full-screen: left brand panel + testimonial / right form | M | med |
| Tutorial | — | NEW | spotlight product tour | L | low |

### Learner

| V2 screen | Maps to | Class | Key deltas | Effort | Risk |
|---|---|---|---|---|---|
| Classroom | `/learn/courses/[slug]` | REDESIGN | Netflix-style module rail (cover cards + progress), lesson grid, study-buddies strip, AI sidebar | M | med |
| Paths | — | **NEW** | learning-paths overview + path detail (modules, hours, completers) | L | low |
| Community | `/learn/community` | **REDESIGN (large)** | left room navigator (grouped, locked rooms), composer on top, trending, post kinds (post/question/win), endorsements, mentions | L | high |
| Credentials | `/learn/credentials` | REDESIGN | verification explainer (dark gradient, signature + credential ID), gradient credential cards | M | med |
| Agenda/Events | `/learn/events` | REDESIGN | event composer (creator), grouped-by-date, .ics export, LIVE NOW badge, replays, RSVP | M | med |
| Messages | — | **NEW** | DM 2-pane (inbox + thread), search, composer, unread | M | med |
| Wishlist | `/learn/wishlist` | ALIGNED | verify card parity + bookmark toggle | S | low |
| Notifications | `/account/notifications` | REDESIGN | dropdown panel + page, color-coded by kind, mark-all-read | S | low |
| Settings | `/learn/settings` + `/account/*` | REDESIGN | consolidate to tabbed page; add learning prefs (captions/speed/dark) + privacy (recommendations, leaderboard, export) | M | med |

### Creator

| V2 screen | Maps to | Class | Key deltas | Effort | Risk |
|---|---|---|---|---|---|
| Studio | `/teach` (`teacher-studio-dashboard.tsx`) | REDESIGN | KPI tiles w/ sparklines, 12mo revenue chart (30d/3m/12m/All), payout projection ring, activity cards, sales funnel, A/B pricing, co-teaching CTA (vs welcome card + ledger) | L | high |
| Builder | `/teach/builder` | REDESIGN | 7-step horizontal stepper, per-step forms, AI assistant FAB, live preview rail, keyboard shortcuts | L | high |
| LessonUploadModal | `lesson-content-modal.tsx` | REDESIGN | tabbed modal (video/description/materials/settings), upload + YouTube dual source, progress bar, drag-drop materials, free-preview toggle | M | med |
| Payouts | `/account/payments` (`teacher-wallet-panel.tsx`) | REDESIGN | bank-account cards, withdraw modal (amount/speed/fee breakdown), statements export, 1099-K tax section | M | med |
| Affiliate | — | **NEW** | referral link card, KPI strip, traffic-sources chart, monthly payouts table | L | high |
| ReviewsModeration | `/teach/refunds` (partial) | **NEW/REDESIGN** | tabs (reviews ↔ refund requests), filter pills, review cards (reply/flag), refund cards (status/actions) | M | high |

### Billing/Account (consolidation)

V2 consolidates `/account/billing` + `/account/payments` + `/account/plans` into one **tabbed Billing
page** (overview / purchases / payment-methods / subscription) + a **refund-request modal**. Current is
split across routes. **Class: REDESIGN (information architecture change).** Effort M, risk med.

### Members area — `membros/` (PT-BR)

A **separate** members-area design (standalone app, professor/aluno role toggle, theme/accent/font
customization). Ties to `docs/plans/2026-06-23-members-area-architecture.md` (instructor-as-tenant,
~70% built — *augment, don't replace*). The English `screens/Classroom|Lesson|Community` are the visual
target; `membros/` is the PT-BR sample. **Decision needed (see §5).**

---

## 4. Already aligned (no/low work)

- Design tokens / brand identity — **100% match**.
- v2.2 card/border/section-head treatment across 46 surfaces (Jun 25 sweep, Waves 1–6 ✅).
- Storefront + account-hub (gold standard pre-plan).
- Wishlist, most account panels (verify only).

---

## 5. Open decisions before building

- **D1 — Role switcher UI.** Add an explicit learner↔creator toggle in the sidebar (V2), or keep the
  current route-based role model? V2's toggle is a UX change touching auth/permissions. *Rec: keep
  route-based for launch; add toggle only if creators routinely need to preview learner mode.*
- **D2 — `membros/` language.** Live site is English ("Skillset USA"). `membros/` is PT-BR. Import the
  *register/layout*, keep the site English unless a PT-BR market is intended. *Rec: English; confirm.*
- **D3 — Scope cuts.** Some V2 features (Affiliate, DM/Messages, A/B pricing, Tutorial) are net-new
  surface area, not re-skins. Treat as **product decisions**, not "design parity". *Rec: defer
  Affiliate + DM + A/B + Tutorial to post-launch; they are features, not polish.*
- **D4 — Paywall coupling.** Niche/public changes must not outrun the open paywall security fix
  (memory `skillset-paywall-leak-deferred`). Coordinate public-surface work with that fix.

---

## 6. Phased plan (recommended order — highest leverage first)

Each wave: small, gated, one surface/cluster per commit, never push (devops-only).

**Wave A — High-visibility redesigns, low risk (the "new face" people feel first)**
1. Auth split layout (`/auth`) — brand panel + testimonial.
2. Onboarding 4-step modal — first interactive impression.
3. Discover rich sections (Continue / Recommended / Paths-teaser / Faculty / CTA).
4. Pricing verify/align.

**Wave B — Core learning surfaces (REDESIGN)**
5. Classroom module rail + lesson grid + AI sidebar.
6. Credentials verification explainer.
7. Notifications color-coded dropdown + page.
8. Settings consolidation (tabs + learning/privacy prefs).

**Wave C — Creator surfaces (REDESIGN, higher complexity)**
9. Studio analytics (KPIs + revenue chart + funnel) — needs data wiring + Framer Motion (already approved).
10. Builder 7-step wizard + LessonUploadModal tabs.
11. Payouts bank cards + withdraw modal + tax section.
12. Billing consolidation (tabbed page + refund modal).

**Wave D — Community (large REDESIGN, high risk) + shell additions**
13. Community redesign (room navigator, top composer, post kinds, endorsements).
14. CommandK global search. Nav badge counts.

**Wave E — Net-new features (product decisions — D3)**
15. Learning Paths. 16. Direct Messages. 17. Affiliate. 18. Reviews/Refunds dashboard. 19. Tutorial tour.

**Members area** (`membros/`) folds into Phase 3 of the Jun 28 plan once D2 is decided.

---

## 7. Execution model & gates (carried from prior plans)

- One surface per pass: read V2 source → edit Next/Tailwind source → verify → next.
- Tokens only (dark-mode safe). No hardcoded hex. Reuse existing shell + `settings-section-card`,
  `button-solid/outline`, `info-notice`, `divide-y` patterns.
- Gates per surface: `npx eslint <files>` + `npx tsc --noEmit` + `npm run build` green → ONE commit
  (`feat(design): …` / `refactor(design): …`). Never stage `docs/` or `.claude/`. Never `git push`.
- Truthfulness (Constitution Art. IV): reframe only real, shipped capabilities. No invented metrics.

---

## 8. Effort tally (rough)

- ALIGNED/verify: ~3 surfaces (S).
- REDESIGN: ~13 surfaces (mostly M, 3 L: Studio, Builder, Community).
- NEW features: 5 (Paths, Messages, Affiliate, Reviews/Refunds, Tutorial) + CommandK.

Realistic sequencing: **Waves A–B** are a few supervised sessions and deliver most of the visible
"new face". **Waves C–E** are larger and partly gated on product decisions (D3) and the paywall fix (D4).
