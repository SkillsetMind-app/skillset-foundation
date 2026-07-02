# Design V2 Implementation — Autonomous Overnight Mandate

**Date:** 2026-07-01
**Branch:** `feat/design-v2` (off `feat/supabase-migration` HEAD `dc49d98`)
**Mandate (Patrick, `/goal`, carta branca):** "continue de forma autonoma sem ficar me perguntando nada vou dormir, para termos o design do v2 na nossa plataforma."

## Ground truth (git-verified + re-derived this session)
- The Supabase backend cutover did **NOT** change the layout. 85 files, all backend; **0 visual files** touched.
- The zip `Skillset DESIGN V2-handoff (1).zip` (exported 2026-06-30) is a Claude Design handoff to *implement forward*, not a backup to restore. Extracted at
  `…/scratchpad/design-v2/skillset-design-v2/project/` (screens/*.jsx, membros/, tokens.css, Área de Membros.html).
- **The platform is ALREADY largely V2.** Prior JARVIS sessions (docs, untracked) established:
  - **Jun-25 sweep** (`2026-06-25-platform-design-alignment.md`): 46 surfaces aligned to "v2.2" (cards, borders, section-heads, dividers, tokens-only). Waves 1-6 ✅ DONE. Zero `rounded-[4px]` left.
  - **Jun-30 gap-map** (`2026-06-30-design-v2-handoff-gap-map.md`): tokens **100% match**, shell already matches, palette LOCKED navy `#1a365d` + red `#b22234`. "No blind porting — founder picks per wave." Residual = net-new features + a few structural redesigns.
  - **Jun-23 members-area** (`2026-06-23-members-area-architecture.md`): instructor-as-tenant, separate-surfaces, theming via scoped CSS-var override, AUGMENT-not-REPLACE (~70% built). *Its Firebase paths are dead post-cutover; the architecture intent still holds.*
- **The gap-map was authored on a different branch** (`feat/niche-comms-and-design-alignment`); several of its "REDESIGN" labels are **stale for this branch**. Verified live: `/auth` already renders the V2 split (`auth-page.tsx` — and it correctly OMITS the ref's fabricated 42K/320+/98% stats + fake testimonial). `onboarding-wizard.tsx` = 750 lines. `course-marketplace.tsx` = 430 lines w/ 3 section heads. → Must AUDIT each surface against current code before touching it.

## Hard constraints
- **Preserve Supabase wiring** (data/auth/payment). Re-skin visual layer only; never drop the ref's backend-less JSX raw.
- **No push** (blocked → @devops). **No deploy** (founder-gated). Local commits only, on `feat/design-v2`.
- **No secret values** anywhere. **No invented data** (Constitution Art. IV): never port a fabricated stat/testimonial/count.
- Every commit = **green checkpoint** (`npx tsc --noEmit` 0 + `npx eslint <files>` 0 + `npx next build` OK + 211 tests). One commit per surface/cluster. **Never stage `docs/` or `.claude/`** (gap-map convention).
- Preserve WCAG AA + dark-mode parity. Palette stays navy.

## Method (corrected)
Not "re-skin everything" (already done) and NOT the dark-warm `membros/` theme (founder decided against — palette stays navy; `membros/` is a PT-BR *sample*, D2). Instead: **audit → implement only genuine, no-invention gaps → gate → commit per surface.**

## Foundation — DONE
`c0251f8 feat(design-v2): foundation — additive V2 primitives`. Purely additive: radius-xs/2xl, on-primary/on-accent, shadow-button/-strong, full --space/--fs/--fw/--tracking/--leading scales, --container/--sidebar/layout tokens, --ease/--duration motion tokens, Inter as `--font-num` + `.num` tabular utility.
**HELD (founder pick pending — "no blind porting"):** the handoff `tokens.css` softens surface-soft `#eef4fc→#f5f9ff`, surface-strong `#e3eef9→#ebf3fb`, `--color-line` `.28→.12`, `--color-line-strong` `.40→.18`, `--color-ink-muted` `#5a6a81→#7a8fae`. NOT applied: the .28/.40 border raise was a documented deliberate fix ("faint = washed out"); the Jun-30 audit concluded tokens already match. `ink-muted #7a8fae` also fails WCAG AA on light surfaces. Listed here so Patrick can opt in.

## Audit (running) → Wave A+B visible-face surfaces
Workflow `design-v2-surface-audit` (8 read-only agents): Auth, Onboarding, Discover, Pricing, Classroom, Credentials, Notifications, Settings. Each returns ALIGNED / MINOR_GAP / REAL_REDESIGN / NET_NEW + concrete gaps tagged realData/invents/tokensOnly/recommend(DO|SKIP|DEFER).

## Then: implement confirmed gaps
For each surface with `recommend:DO` gaps: edit current component (preserve wiring, tokens-only, navy, no invention) → gate → commit. Defer net-new features (Paths/Messages/Affiliate/Tutorial/AI-sidebar — D3 product decisions). Skip anything needing invented data.

## Status — COMPLETE (overnight)
- [x] Branch + plan
- [x] Foundation (additive tokens/fonts) — green + committed `c0251f8`
- [x] Surface audit (Wave A+B, 8 surfaces) — done, absorbed
- [x] Implement confirmed real gaps — per-surface green + committed:
  - `8c22806` auth — password show/hide + inline forgot link
  - `2998fac` onboarding — completion answer-recap
  - `33fdf73` pricing — monthly/annual toggle + FAQ
  - `db442b2` notifications — kind-colored chips + all/unread filter
  - `6ebf6af` discover — continue-learning strip + grid/list toggle + category counts
  - `87980eb` settings — profile + security panels → shared section-card
  - Classroom (`enrolled-course-workspace.tsx`) — verified ALIGNED, no-op
  - Credentials (`learn-credentials-hub.tsx`) — verified ALIGNED, no-op
- [x] Deferred net-new documented → `2026-07-01-design-v2-deferred-netnew.md` (D3/D4 net-new, D2 rejected)
- [x] Each commit gated green (tsc 0 · next build OK · 211/211 vitest). No push, no deploy — awaits Patrick.
- [ ] Founder decisions pending: merge `feat/design-v2` → dev branch (irreversible-ish → left for Patrick); HELD token softening opt-in; D1/D3/D4.
