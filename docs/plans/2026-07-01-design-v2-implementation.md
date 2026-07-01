# Design V2 Implementation — Autonomous Overnight Mandate

**Date:** 2026-07-01
**Branch:** `feat/design-v2` (off `feat/supabase-migration` HEAD `dc49d98`)
**Mandate (Patrick, `/goal`, carta branca):** "continue de forma autonoma sem ficar me perguntando nada vou dormir, para termos o design do v2 na nossa plataforma."
**Confirmed direction:** Implement V2 **phased** (member area first), on top of the Supabase backend.

## Ground truth (git-verified)
- The Supabase backend cutover did **NOT** change the layout. 85 files, all backend; **0 visual files** touched (no globals.css, tailwind, layout.tsx, tokens, public assets).
- The zip `Skillset DESIGN V2-handoff (1).zip` is a **Claude Design handoff** (exported 2026-06-30) — a NEW V2 design to *implement*, not a backup to restore. Its README: "so a coding agent can implement the designs for real." Primary file: `Área de Membros.html` (member area).
- The current Next.js app already has a mature design system in `src/app/globals.css` (navy #1a365d / red #b22234, Manrope + Cormorant, dark mode, WCAG-tuned). So V2 is a delta on top of an existing design, not a from-scratch skin.

## Hard constraints
- **Preserve the Supabase backend wiring** (data/auth/payment). Re-skin the VISUAL layer of existing components; never drop the zip's backend-less JSX in raw.
- **No push** (blocked → @devops). **No deploy** (founder-gated). Local commits only, on `feat/design-v2`.
- **No secret values** written anywhere.
- Every commit must be a **green checkpoint** (tsc 0 + eslint 0 + build + 211 tests pass). Commit incrementally so nothing is lost overnight.
- Preserve accessibility (WCAG AA) and dark-mode parity already present.

## Phases
1. **Extract + Delta** — Agent reads the full V2 bundle (`Área de Membros.html`, `app.css`, shared components, `membros/*`), writes `docs/design-v2/DESIGN-SYSTEM-V2.md` (tokens, components, screens) + a DELTA table vs the current tokens. Answers the key question: does V2 keep navy/red + Manrope/Cormorant, or change direction?
2. **Foundation** — Apply the token/font/shared-chrome delta into `globals.css` + shared shell components. Green build + commit. This is the coherence anchor; must be locked before fan-out.
3. **Screens (phased)** — Re-skin priority screens against the locked foundation + V2 reference, preserving data wiring. Start with the Member Area (`/learn/*`), then high-traffic screens. Green build + commit per batch (parallel fan-out where files are disjoint).
4. **Verify + Manifest** — Full build/tsc/eslint/tests; consistency review vs V2 spec; write a DONE/REMAINING manifest and morning report.

## Scope priority (member-facing first, per handoff)
Área de Membros (home/classroom) → Lesson → Discover → Community → Course detail → Billing/Pricing → Settings/Profile → (teacher/studio screens) → (admin/ops).

## Status
- [x] Branch + plan
- [ ] Phase 1: V2 spec + delta
- [ ] Phase 2: Foundation (tokens/fonts/chrome) — green + commit
- [ ] Phase 3: Screens (phased, per-batch green + commit)
- [ ] Phase 4: Verify + manifest + morning report
