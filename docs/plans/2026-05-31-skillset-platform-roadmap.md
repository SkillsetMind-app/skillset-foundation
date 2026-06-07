# Skillset — Plano de Melhoria de Plataforma (FE + BE)

> **Data:** 2026-05-31
> **Contexto:** Demo de investidor iminente, com pagamentos LIVE (Option B).
> **Método:** Auditoria por superfície (marketing/auth, aluno, professor, conta/billing, cursos/checkout, design-system/contraste/tema, backend/pagamentos, ops) + síntese priorizada. Toda afirmação é rastreada a arquivo:linha (No-Invention).
> **Repo canônico:** `C:/Users/nicae/aiox-core/projects/skillset-foundation` (NUNCA a cópia do OneDrive).

---

## 1. Sumário executivo

A plataforma está **mais madura no backend do que na fachada**. As 28 Cloud Functions (`functions/src/index.ts`) são bem construídas: toda callable valida `request.auth` e gateia por papel (`teacher`/`admin`/owner), o progresso é server-authoritative, o release de payout roda em cron (`dailyReleaseTransfers`), há fluxos de refund (`requestRefund`, `issueAdminRefund`), webhook Stripe (`stripeWebhook`) e **assinatura já totalmente implementada** (`createBillingCheckoutSession`, `createBillingPortalSession`). Pagamento LIVE na demo é **baixo risco técnico** — o motor existe e está protegido.

Os problemas reais são **de fachada e de verdade**: rotas de professor que são stubs "coming soon" alcançáveis pela navegação, copy que promete mais do que o produto entrega (features e prazo de payout), polish de contraste/acessibilidade (2 já corrigidos hoje), e o gap de monetização vs. Cakto (order bump / upsell / afiliados — zero implementação). Nada disso é arquitetura quebrada; é alinhamento, verdade e acabamento.

**Veredito de prontidão para demo:** 🟡 **Pronto com ressalvas.** O caminho feliz (descobrir curso → comprar LIVE → consumir) deve funcionar. Antes da demo é preciso (a) decidir o que fazer com os 4 stubs de professor alcançáveis na navegação, (b) alinhar a copy de payout (diz 7, código faz 10) e a `/promise`, e (c) fazer um smoke test LIVE de US$1 ponta-a-ponta. Tudo Wave 0, baixo esforço.

---

## 2. O que já foi corrigido nesta sessão

| Item | Arquivo | Status |
|------|---------|--------|
| Contraste do menu lateral ativo (texto navy sobre fundo navy = invisível) | `src/components/platform/platform-nav.tsx` | ✅ corrigido (commit `f810798`) |
| Gêmeo do mesmo bug no toggle de ciclo de cobrança | `src/components/account/plans-panel.tsx:148` | ✅ corrigido (commit `f810798`) |
| Varredura de contraste (anti-padrão `text-[var(--color-base)]` e `platform-nav-active` mal-usado) | `src/` inteiro | ✅ varrido — só existiam nesses 2 pontos |

---

## 3. Wave 0 — Bloqueadores de demo (fazer antes do investidor)

Objetivo: nada que envergonhe em diligence ou quebre fluxo de dinheiro live.

| # | Item | Arquivos | Camada | Esforço | Por quê |
|---|------|----------|--------|---------|---------|
| 0.1 | **Decidir destino dos 4 stubs de professor** alcançáveis pelo menu (renderizam "on the roadmap") | `src/app/teach/integrations/page.tsx`, `.../co-productions/page.tsx`, `.../team/page.tsx`, `.../coupons/page.tsx` | FE | S | Investidor clicando no sidebar de professor cai em telas vazias "em breve". Opções: esconder do nav na demo, ou rotular claramente como roadmap Q3. |
| 0.2 | ✅ **RESOLVIDO (2026-06-06): payout reconciliado em 30 dias** | `functions/src/payment-rules.ts:12` (`payoutReleaseDelayDays=30`) + `src/data/plans.ts:196` (`payoutClearDays=30`) | FE+BE | ✅ | Single source of truth em 30. A UI já estava data-driven em 30; docs/comentários históricos anotados/corrigidos. Reembolso segue 7. Ver DECISIONS D21. |
| 0.3 | **Enxugar `/promise` para o que está shipado** (promete affiliate, community, analytics, quizzes, certificates, drip, custom domains) | `src/app/promise/page.tsx:17` | FE | S | Afiliados/analytics não existem. Manter como visão é ok — mas marcar "em breve" para não virar promessa falsa em diligence. |
| 0.4 | **Smoke test LIVE de US$1 ponta-a-ponta** (compra de curso + 1 assinatura de plano) | `createCheckoutSession`, `createBillingCheckoutSession` (`functions/src/index.ts`) | — | S | **Ação do fundador** (cartão real). Confirma webhook → enrollment → wallet com dinheiro de verdade. |
| 0.5 | **Validar caminho feliz do aluno** na conta de demo (enroll → consumir → progresso → certificado) sem estados vazios/quebrados | `src/app/learn/*`, `recordLessonProgress`, `issueSkillsetCertificate` | FE+BE (validação) | S | É o que o investidor vê. Garantir que renderiza limpo na conta de demo. |

---

## 4. Wave 1 — Quick wins (alto valor, baixo esforço)

Objetivo: verdade, acabamento e coerência. Tudo pré-autorizado, baixo risco.

| # | Item | Arquivos | Camada | Esforço | Por quê |
|---|------|----------|--------|---------|---------|
| 1.1 | **Redesign do theme-toggle** (#6 do fundador): animação de transição sol/lua (cross-fade + rotate), micro-interação no clique, manter `aria-label`/focus-ring | `src/components/shared/theme-toggle.tsx` | design-system | S | Hoje é swap instantâneo de ícone, visualmente cru. A11y já ok. É puro polish de taste. |
| 1.2 | **Passe de verdade na copy** (alinhar todos os claims de payout/feature com a realidade) | `capabilities-grid.tsx`, `how-it-works-strip.tsx`, `help/page.tsx`, `trust/page.tsx`, `promise/page.tsx` | FE | S | Coerência de mensagem entre marketing, help e produto. |
| 1.3 | **Habilitar pricing de assinatura de curso** — o backend já aceita `subscription_monthly`/`subscription_yearly` (`functions/src/index.ts` `builderPaymentTypes`); a UI desabilita com "Coming soon" | `src/components/teacher/course-builder-studio.tsx` (un-disable) + teste do caminho existente | FE (BE já pronto) | M | Feature "nova" quase de graça: a maior parte já existe no backend. Diferencial de receita recorrente. |
| 1.4 | **Auditoria de estados vazios/loading/erro** nas superfícies de aluno e professor | `src/app/learn/*`, `src/app/teach/*` | FE | M | Estados vazios elegantes evitam o "parece quebrado" na demo. |
| 1.5 | **Consistência de focus-ring e contraste em dark mode** (sweep além do nav já corrigido) | `src/app/globals.css`, componentes interativos | design-system | M | Acessibilidade e polish uniformes em ambos os temas. |
| 1.6 | **Acabamento dos 4 stubs** (se a decisão 0.1 for "manter"): transformar o painel genérico em "roadmap" com data e CTA de notificação | `src/app/teach/{integrations,co-productions,team,coupons}/page.tsx` | FE | S | Transforma "vazio" em "vem aí", que vende visão em vez de expor buraco. |

---

## 5. Wave 2 — Big bets (construção maior, pós-demo)

Objetivo: paridade competitiva e profundidade. FE **e** BE em conjunto.

| # | Item | Camada | Esforço | Por quê |
|---|------|--------|---------|---------|
| 2.1 | **Order bump no checkout** (oferta complementar 1-clique) | FE+BE | M | Gap vs Cakto. Zero implementação hoje (ver `docs/benchmarks/cakto-vs-skillset-comparison.md`). +ticket médio. Exige novo fluxo Stripe + UI de checkout. |
| 2.2 | **Upsell / downsell pós-compra** | FE+BE | L | Gap vs Cakto. Exige orquestração de ofertas encadeadas + estado de funil no BE. |
| 2.3 | **Programa de afiliados** (links, atribuição, ledger, comissão) | FE+BE | L | Prometido na `/promise` mas inexistente. Novo ledger + atribuição no BE + dashboard no FE. Maior peça de monetização. |
| 2.4 | **Profundidade de analytics** (LTV, churn, abandono, receita por afiliado) | FE+BE | L | `teacher-studio-insights.tsx` hoje só tem receita/top-cursos/próximo-payout. Exige agregações no BE. |
| 2.5 | **Profundidade do OpsDashboard** (review de curso, aprovação de educador, fila de suporte realmente operáveis) | FE+BE | M | `src/app/ops/page.tsx` é real e gated, mas os controles precisam virar ferramentas de verdade conforme escala. |

---

## 6. Coordenação FE ⇆ BE (onde um exige o outro)

| Tema | Estado BE | Estado FE | Ação coordenada |
|------|-----------|-----------|-----------------|
| **Assinatura de curso** | ✅ pronto (`builderPaymentTypes`, billing callables) | ❌ desabilitado ("Coming soon") | Só destravar o FE (1.3) + testar caminho existente. Não precisa BE novo. |
| **Prazo de payout** | ✅ `payoutReleaseDelayDays=30` (resolvido, Q1) | ✅ copy já em 30 (`payoutClearDays=30`) | RESOLVIDO 2026-06-06: 30 dias é o número final. BE, FE e docs reconciliados. Reembolso segue 7. |
| **Order bump / upsell / afiliados** | ❌ inexistente | ❌ inexistente | Construção conjunta. Começar pelo BE (fluxo Stripe + ledger), depois FE. |
| **Refund window vs payout** | ✅ refund=7, payout=30 (payout libera bem após a janela de refund) | ✅ copy explícita sobre os dois prazos | RESOLVIDO: payout (30) ≥ refund (7) com folga; sem risco de clawback. |

---

## 7. Perguntas abertas para o fundador

1. **Payout:** ✅ **RESOLVIDO (2026-06-06):** padronizado em **30 dias** (`payoutReleaseDelayDays=30` / `payoutClearDays=30`). Refund segue 7. Toda a copy e os docs foram reconciliados para 30.
2. **Stubs de professor na demo:** esconder os 4 do menu, ou manter com rótulo claro de "roadmap Q3 + me avise"?
3. **`/promise`:** enxugar para o que está shipado, ou manter como visão com tag "em breve" nos itens não construídos (affiliate, analytics, quizzes, custom domains)?
4. **Assinatura de curso:** habilitar já para a demo (backend pronto) ou segurar?
5. **Order bump:** formato Cakto (um bump único no checkout) ou múltiplos bumps? Define o desenho do 2.1.

---

## 8. Apêndice — Forças confirmadas (o que NÃO mexer)

- **Backend de pagamentos sólido e gated:** 28 functions em `functions/src/index.ts`, toda callable checa `request.auth` + papel; owner/admin gating; input validation pesada; progresso server-authoritative.
- **Stripe Connect completo:** account links, webhook, refunds, cron de release (`dailyReleaseTransfers`), expiração de pedidos pendentes (`expireStalePendingOrders`).
- **Multi-moeda live:** 30 moedas suportadas (`supportedStripeCurrencies`).
- **Certificados:** emissão + verificação pública (`verifySkillsetCertificateHttp`).
- **Ops real e protegido:** `src/app/ops/page.tsx` gated por `platform.accessAdmin`.
- **Course builder robusto:** validação de módulos/lições, 7 tipos de lição, drip por lição.

---

*Gerado inline (loop principal) após o workflow de enxame em background ser morto 2× por restart de sessão. Auditoria e síntese feitas diretamente, com todas as citações verificadas em arquivo:linha.*
