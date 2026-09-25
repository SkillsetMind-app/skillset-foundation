> **OBSOLETO.** Este documento descreve a arquitetura da era Firebase e é mantido apenas como histórico.
> A stack atual é Next.js na Vercel + Supabase (Postgres, Auth, Storage). Não siga caminhos, comandos ou
> serviços citados aqui; consulte `AGENTS.md` e `.mex/context/setup.md`.

# Master Prompt — Cakto → SkillsetUSA Competitive Design Comparison

> **What this is:** a ready-to-paste prompt for the session that already has the SkillsetUSA project context. It drives a structured comparison between **Cakto** (a Brazilian checkout/infoproduct platform we captured as a benchmark) and **SkillsetUSA** (`skillset-foundation`), to produce prioritized, buildable improvement recommendations.
>
> **How to use:** open the SkillsetUSA working session and paste everything inside the `=== PROMPT ===` block below. Make sure the session can read `docs/benchmarks/cakto-reference-dossier.md` in this same repo.
>
> **Why this exists:** the Cakto frontend was seen frame-by-frame in another session (JARVIS / `/watch` skill). That visual knowledge is captured in the dossier — this prompt hands it off so the comparison runs where the project context lives.

---

```
=== PROMPT ===

ROLE
You are a senior product + design engineer working inside the SkillsetUSA repo
(`skillset-foundation`, Next.js 16 + Firebase Functions + Stripe Connect + Tailwind 4).
Your job: compare SkillsetUSA against the Cakto benchmark and produce prioritized,
buildable recommendations that fit our stack and our market (US / Stripe, English UI).

INPUTS (read these first, in order)
1. `docs/benchmarks/cakto-reference-dossier.md` — the full Cakto teardown (design, UX,
   features, modals, monetization flows) + a Cakto→SkillsetUSA file-level mapping matrix.
2. The live SkillsetUSA app: https://skillsetusaofficial.web.app (inspect real screens).
3. The repo itself. Seed paths to anchor each comparison (already mapped for you):
   - Shell/nav:      src/components/platform/{platform-shell,platform-nav,platform-header,sidebar-toggle}.tsx
   - Shared UI:      src/components/shared/{theme-toggle,horizontal-tabs,dashboard-filters,status-chip,export-table-button}.tsx
   - Help widget:    src/components/platform/help-bubble.tsx
   - Account menu:   src/components/site/account-menu.tsx
   - Teacher dash:   src/components/teacher/{teacher-studio-dashboard,teacher-overview-metrics,teacher-studio-insights}.tsx
   - Sales:          src/components/teacher/{sale-list,sale-detail}.tsx  +  src/app/teach/sales/
   - Course builder: src/components/teacher/{create-course-start,course-builder-studio,teacher-course-studio}.tsx  +  src/app/teach/builder/
   - Checkout:       src/components/account/embedded-checkout-panel.tsx
   - Wallet/payout:  src/components/teacher/teacher-wallet-panel.tsx  +  functions/src/payment-rules.ts
   - KYC/Connect:    src/components/teacher/teacher-connect-onboarding.tsx
   - Marketplace:    src/components/courses/course-marketplace.tsx  +  src/app/courses/
   - Learner area:   src/app/learn/  +  src/components/learn/*
   - Coupons / Co-prod / Integrations: src/app/teach/{coupons,co-productions,integrations}/
4. Prior benchmarks already discussed in this session: Hotmart and Skool. Use them as
   secondary reference where relevant (Skool = community/learning; Hotmart = marketplace+checkout).

TASK
Produce a dimension-by-dimension comparison across these 5 dimensions (same axes as the dossier):
  D1. Visual design (theme, palette, layout, density)
  D2. UX / frontend patterns (navigation, tabs, filters, modals, live previews, onboarding gating)
  D3. Features / backend capability (what each platform can actually do)
  D4. Modals & components (reusable UI building blocks)
  D5. Monetization flows (the end-to-end "sell" path)

METHOD (do this, in order)
1. Read the dossier. For each Cakto element, confirm the mapped SkillsetUSA file actually
   exists and read enough of it to judge parity. Mark each: ✅ have / 🟡 partial / ❌ missing.
2. For 🟡 and ❌, write a concrete "what Cakto does that we don't" delta — grounded in the
   real file (cite the path). NO invented gaps (Constitution Article IV — No Invention).
3. Cross-check against the live site where a screen is ambiguous in code.
4. Build the comparison matrix + a prioritized recommendation list.

PRIORITIZATION
Score each recommendation on Impact (revenue/retention) × Effort (our stack reality):
  - Quick wins:   high impact, low effort, fits existing components.
  - Big bets:     high impact, high effort (e.g., new backend in functions/).
  - Skip/defer:   low impact OR doesn't fit US/Stripe market.
Flag explicitly anything that is BR-specific (Pix/Boleto, CPF/CNPJ KYC) and does NOT transfer
to our US/Stripe context — do not recommend porting those literally.

KNOWN HIGH-VALUE GAPS (from the dossier — validate, don't assume)
The dossier flags these as present in Cakto but absent in SkillsetUSA. Confirm in-repo, then
size each:
  - Order Bump (complementary offer at checkout) → anchor: embedded-checkout-panel.tsx
  - Upsell/Downsell 1-click post-purchase       → anchor: payment-rules.ts (backend support)
  - Affiliate program (distinct from co-productions) + affiliate marketplace
  - Live preview inside offer-config modals
  - Multi-platform conversion pixels (FB/Google/TikTok) beyond PostHog → /teach/integrations

OUTPUT FORMAT
Write to `docs/benchmarks/cakto-vs-skillset-comparison.md`:
  1. Executive summary (5 bullets: biggest opportunities).
  2. Comparison matrix (Dimension | Cakto | SkillsetUSA + file | Verdict ✅/🟡/❌ | Note).
  3. Prioritized recommendations (Quick wins → Big bets → Defer), each with:
     - what to build, which file(s) it touches, rough effort, expected impact,
     - and whether it needs a new story (we are story-driven; see docs/stories/).
  4. Explicit "do NOT port" list (BR-specific items).
  5. Open questions for the founder.

CONSTRAINTS
- Story-driven: frame buildable items as candidate stories, don't start coding.
- No invention: every claim about SkillsetUSA must cite a real file you read.
- Respect the stack: recommendations must fit Next.js 16 / Firebase Functions / Stripe Connect.
- The OneDrive copy of this repo is DEAD — only `aiox-core/projects/skillset-foundation` is canonical.

=== END PROMPT ===
```

---

## Notas para o senhor (não fazem parte do prompt)

- **Idioma:** o prompt está em **inglês** de propósito — ele roda na sua sessão da SkillsetUSA (mercado/UI em inglês), então o agente de lá opera no idioma do projeto. O **dossiê** ficou em PT-BR (a fonte é BR e o senhor valida o que eu vi); Claude lê PT sem problema. Se preferir tudo num idioma só, eu traduzo.
- **Saída esperada:** o prompt manda o agente da outra sessão gravar `cakto-vs-skillset-comparison.md` nesta mesma pasta `docs/benchmarks/` — fechando o ciclo no repo.
- **Já fiz o trabalho pesado de mapeamento:** os "seed paths" no prompt são os arquivos reais que eu localizei, então a outra sessão não começa do zero.
