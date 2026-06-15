# Skillset — Design Refinement Plan

> Status: PLAN (awaiting go + 2 taste decisions before Phase 1)
> Audited: 2026-06-15 by JARVIS (senior front-end pass)
> Branch target: `fix/payment-subscription-and-demo-cta` (or a fresh `feat/design-refinement`)

---

## 1. How this was audited

| Surface | Method | Notes |
|---|---|---|
| Home `/` | Live preview, full scroll (hero → footer) | 5 segments captured |
| Marketplace `/courses` | Live preview | Empty state only — no seeded courses in local dev |
| Pricing `/pricing` | Live preview, full | 4-tier table |
| Auth `/login` → `/auth` | Live preview | Sign-in card |
| Design system | `src/app/globals.css` tokens | Colors, shadows, radius, fonts |
| App surfaces (teach/learn/account/platform) | Component source | Data-gated locally — visual passes deferred to execution (seed a test account OR use live site with owner login) |

**Honest gap:** the *product* surfaces the senhor feels are most "amateur" (teach studio, learn workspace, account, dashboards) cannot be screenshotted in local dev because Firestore has no seeded data and they are auth-gated. They are audited here from code; each gets a real before/after visual pass during execution.

---

## 2. Diagnosis — why it reads "amateur" (5 root causes)

The design system is **not** the problem — tokens, dark mode, semantic colors, shadows and radii all exist and are coherent (navy `#1a365d` + USA red `#b22234`, Cormorant display + Manrope sans). The "amateur" perception comes entirely from **application**:

1. **Low contrast / washed-out surfaces.**
   `--color-line` is navy at **0.20 opacity** → borders nearly invisible. Cards use `--color-surface-soft #eef4fc` on a white page → they barely separate. Feature cards (home) and pricing cards both "dissolve" into the background.
   *Evidence: home "Everything included" grid, pricing cards.*

2. **No imagery, no product visuals.**
   Every content surface is text + tiny gray icons. The hero's **right half is empty navy** with no mockup/screenshot/illustration. This is the single strongest "unfinished" signal.
   *Evidence: home hero, all marketing sections.*

3. **Layout imbalance & weak composition.**
   Content sits in a narrow left column with large empty right space; footer link columns leave most of the row blank; the auth card floats top-center over a vast empty page.
   *Evidence: hero, footer, `/auth`.*

4. **Inconsistent vertical rhythm.**
   There is **no `--space-*` scale** — section padding is ad-hoc, producing large/erratic gaps between sections (e.g. big void under "How it works").
   *Evidence: home, gaps between every section.*

5. **Type & secondary-text hierarchy.**
   Cormorant display reads thin at the sizes used; body and secondary text are small and set in light grays (`--color-ink-soft #4d6785`, `--color-ink-muted #5a6a81`) → weak hierarchy, sub-AA contrast in places.

---

## 3. The fix — ordered by leverage

### Phase 0 — Quick wins (1 session · highest visual ROI · low risk · token-level)
Global changes that lift *every* page at once:
- [ ] `--color-line` 0.20 → ~0.30; `--color-line-strong` 0.30 → ~0.40 (visible card/section borders)
- [ ] Apply `--shadow-soft` to feature/pricing/info cards so they lift off the page
- [ ] Darken `--color-ink-soft` and `--color-ink-muted` one step → WCAG AA on white
- [ ] Hero: fill the empty right half (product mockup / dashboard frame / abstract brand visual) **or** rebalance to a centered hero
- [ ] Vertically center the `/auth` card (or split-layout it) so it stops floating in emptiness

### Phase 1 — Design-system hardening (systemic · applies everywhere)
- [ ] Add `--space-*` scale (4/8/12/16/24/32/48/64/96) and a `--text-*` type scale; refactor section padding + headings to use them → consistent rhythm
- [ ] Standardize one `Card` treatment (elevation, border, radius, hover) and replace ad-hoc card styling
- [ ] Full contrast pass to WCAG AA across ink/line/surface tokens (light **and** dark)
- [ ] Heading system: fix Cormorant weights/sizes, or evaluate a sturdier display face (see decision D1)

### Phase 2 — Per-surface visual passes (the actual product — one surface per pass)
Order by business impact:
1. [ ] Marketplace grid + course card (populated): imagery, rating, price clarity, hover
2. [ ] Course detail + checkout: trust signals, hierarchy, CTA prominence
3. [ ] Teach studio dashboard / sales / payouts / builder: data density, status clarity, empty states
4. [ ] Learn workspace + community + credentials
5. [ ] Account settings (billing, profile, security, notifications)
6. [ ] Auth / signup / onboarding: first interactive impression

### Phase 3 — Polish & motion
- [ ] Micro-interactions, transitions, focus-visible states
- [ ] Loading / skeleton / empty states everywhere
- [ ] Responsive QA (mobile 375 / tablet 768) + dark-mode QA on every refactored surface

---

## 4. Execution model
- **One surface per pass:** screenshot (before) → edit source → verify (after) in preview → next.
- **Gates after each phase:** `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- **Deploy** when a phase is stable (`firebase deploy --only hosting`).
- Track progress against this doc's checkboxes (or promote to GSD phases).

---

## 5. Decisions needed before Phase 1 (taste calls — the senhor's)
- **D1 — Display typeface:** keep the editorial serif (Cormorant) for brand character, or move to a cleaner modern sans-display for a more "SaaS/product" feel? (Changes brand identity.)
- **D2 — Imagery direction:** real product screenshots, custom illustration, or abstract/geometric brand visuals? (Drives Phase 0 hero + Phase 2.)

---

## 6. Appendix — token references
- Tokens: `src/app/globals.css` `:root` (light) and `.dark`/media block (dark)
- Key offenders: `--color-line` (L29), `--color-ink-soft` (L22), `--color-ink-muted` (L28), `--color-surface-soft` (L6)
- Fonts: `--font-display: Cormorant` (L96), `--font-sans: Manrope` (L95)

---

## 7. Live-site audit findings (2026-06-15, authenticated session)

Audited the **live** site (`skillsetusaofficial.web.app`) via the owner's logged-in
browser (read-only navigation; no credentials entered by JARVIS).

**Critical context — the platform is PRE-LAUNCH.** No courses are published; the
marketplace shows "Marketplace opening soon" even in production, and the studio shows
all-empty stats. Every "hollow" surface is an *empty state*, not a bug. Implication:
"real product screenshots" for the hero do not exist yet → interim hero uses
abstract/brand visuals + a product-frame mockup; swap to real screenshots post-launch.

| Surface | Finding |
|---|---|
| Home hero (1568px) | Right ~half is empty navy — the #1 "unfinished" signal. Highest-priority fix. |
| Teacher Studio `/teach` | Well-structured (sidebar + stats + chart + activity), but stat cards are hollow + low-contrast; revenue row's right column collapses to a void; "Next payout" shows a gray placeholder bar. |
| Marketplace `/courses` | Empty state is fine; populated grid unviewable (no data) → audit course card from code. |
| Systemic | Same across public + app: faint borders, washed-out cards, no imagery, irregular vertical rhythm. |

## 8. Stack / library verdict (criterious evaluation — the gate)

KEEP: Next 16 + React 19 + Tailwind 4 (already best-in-class; right tools for uniform spacing).
ADD (only one): **Framer Motion** for "defined animations" (real gap; CSS-only today).
REJECT: Vue/Angular (= full rewrite), React Native/Flutter (native apps = separate project; mobile = responsive web + PWA), Mantine (own styling system clashes with Tailwind 4 + tokens → more inconsistency). Optional later: Radix headless (shadcn pattern) only if accessible primitives are needed.

## 9. Progress log
- [x] **Phase 0 #1 — border contrast** raised in `globals.css` (light 0.20→0.28 / 0.30→0.40; dark 0.14→0.20 / 0.24→0.32). Verified on `/pricing` preview: cards now have defined edges.
- [x] **Phase 2 #home-hero — filled the empty right half (the #1 eyesore).** New `hero-product-preview.tsx`: a code-built product frame (app window → "Reviewed by Skillset" course card → `$149` + "30+ currencies"), plus two floating value-prop chips ("Payout cleared", "Certificate verified"). `marketing-hero.tsx` restructured to a 2-column grid on `lg` (content left / visual right), single centered column on mobile (visual `hidden lg:block`). Colors are FIXED brand values, not theme tokens — the hero is an always-navy section in both themes, and tokens invert in dark (would break contrast). Pre-launch honesty: shows product *structure* + value props, not fabricated revenue metrics; swap to real screenshots once courses ship.
- [x] **Phase 3 (partial) — motion.** `@keyframes hero-float` drives a gentle drift on the two chips, motion-gated under `prefers-reduced-motion` (chips fully positioned without it).
- **Verified (DOM geometry, local preview):** 1440px → grid `604/556`, frame + chips in right half; 1024px (lg boundary) → `465/428`, no clipping, no h-overflow; 375px mobile → preview `display:none`, content centered, no overflow. (Preview screenshot tool hangs on this renderer — captured via DOM measurement; live visual proof via Chrome post-deploy.)
- **Gates green:** `tsc --noEmit` 0 · `eslint` (changed) 0 · `next build` 0 · `vitest` 201/201 (incl. `marketing.test.tsx` home thesis).

