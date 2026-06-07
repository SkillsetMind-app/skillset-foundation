# Skillset — Backlog de Melhoria Priorizado (FE + BE)

> **Data:** 2026-06-06
> **Método:** Auditoria interna (FASE 1, 9 dimensões) + benchmark competitivo (FASE 2 — Skool + Cakto) consolidados num backlog único e pontuado.
> **No-Invention (Article IV):** toda alegação técnica é rastreada a `arquivo:linha`. Itens marcados ✓ foram confirmados por leitura direta do código nesta sessão; os demais vêm dos finders de auditoria (rotulados como tal — honestidade epistêmica).
> **Repo canônico:** `C:/Users/nicae/aiox-core/projects/skillset-foundation` (NUNCA a cópia do OneDrive).
> **Ground truth desta sessão:** `lint` exit 0 (limpo) · `vitest run` → **22 arquivos / 92 testes passando**.
> **Atualização 2026-06-06 (FASE 2 aprofundada):** itens competitivos C1–C12 refinados com evidência **primária de vídeo** (assisti o produto Skool real) + **exploração ao vivo da Cakto na conta real** (logado, criei um produto de teste do zero, abri cada aba do editor, o checkout builder, o sistema de afiliados ponta-a-ponta e a tabela de taxas do produtor) + **capability map de código** (`file:line`). Detalhe completo em `docs/benchmarks/skool-vs-skillset-2026-06-06.md`.

---

## Como ler a pontuação

Cada item tem **Impacto (1-5)** e **Esforço (1-5)**. Para a ordenação ser sensata (alto impacto + baixo esforço no topo), defino:

```
Facilidade = 6 − Esforço
Score      = Impacto × Facilidade        (faixa 1–25, maior = faça primeiro)
```

Assim um item Impacto 5 / Esforço 1 = **25** (topo), e um Impacto 3 / Esforço 4 = **6** (fundo). As colunas Impacto e Esforço ficam visíveis para transparência total.

Severidade (da auditoria) é independente do score: mede **gravidade técnica** (alta/média/baixa), enquanto o score mede **prioridade de execução** (valor ÷ custo).

---

## FASE 0 — Estado atual (recap de 5 pontos)

1. **Pagamentos LIVE e robustos.** 28 Cloud Functions, Stripe Connect completo (webhook, refunds com reversão proporcional de transfer, cron de release, billing de assinatura). Split verificado em teste: $100 USD → professor $88.80 / plataforma $8.00.
2. **Backend > fachada.** O motor é forte; os gaps reais são de **verdade (copy), acabamento, acessibilidade e camada de conversão/engajamento** — não de arquitetura quebrada.
3. **Discrepância de payout ✅ RESOLVIDA (2026-06-06, T1).** Código vivo = **30 dias** (`payment-rules.ts:12`); a UI já estava em 30 (`payoutClearDays=30`); só os docs históricos diziam 7/10 — agora reconciliados. Single source of truth estabelecido. Sem mais risco de diligence neste ponto.
4. **Stubs de professor alcançáveis pelo menu** (`integrations`, `co-productions`, `team`, `coupons`) renderizam "coming soon" — investidor clicando cai em tela vazia.
5. **Correção: community feed e events JÁ EXISTEM** (`course-community-feed.tsx`, `learn-events-hub.tsx`, `teacher-event-studio.tsx`). O doc Cakto antigo os listava como gap — falso. Gaps competitivos reais encolhem para 3 peças cirúrgicas (gamificação, afiliados, discovery).

---

## ✅ Callout RESOLVIDO: a discrepância de payout (Q1) — reconciliado em 30 dias (2026-06-06)

> **RESOLVIDO (T1).** Decisão do fundador: payout = **30 dias** (canônico, já vivo). Correção importante: a UI **já estava em 30** (data-driven de `payoutClearDays=30`) — a alegação da auditoria de que "a copy de UI diz 7 dias" estava **desatualizada**. O que carregava número velho eram só os **docs/decisões históricos**, agora anotados como SUPERSEDED ou corrigidos para 30. Reembolso segue 7.

Histórico da discrepância (o que foi reconciliado):

| Fonte | Número | Localização |
|-------|--------|-------------|
| **Código canônico (vivo, deployado)** | **30 dias** | `functions/src/payment-rules.ts:12` ✓ |
| Docs antigos (HANDOFF/DECISIONS/roadmap) | "D+10" | `docs/plans/2026-05-31-...md:37` (desatualizado) |
| Copy de UI/marketing | **já em 30** ✓ (a alegação "7 dias" era stale) | data-driven de `payoutClearDays=30` (9 páginas); os "7 dias" remanescentes são a janela de *reembolso* (corretos) |

O refund window é **7 dias** (`payment-rules.ts:27`). Payout ≥ refund (nunca liberar payout enquanto a cobrança ainda é reembolsável) — **30 satisfaz isso com folga**. ✅ **Decisão do fundador (Q1, 2026-06-06): manter 30 + copy honesta.** Executado: comentário em `index.ts:2987`, `DECISIONS.md` (D3/D16→SUPERSEDED + nova D21), roadmap, demo-readiness, `HANDOFF.md`, `TEST_RESULTS.md` e benchmark Cakto reconciliados para 30. Verificado por grep: zero referência de *payout-timing* fora de 30 remanescente.

> **Prova externa (Cakto, capturado ao vivo 2026-06-06):** um PSP maduro **não esconde** payout-timing — ele publica uma **tabela por método de pagamento** (Pix D+1 · Boleto D+2 · Cartão D+15 · wallets D+30). Isso confirma que três números conflitantes (código 30 / docs 10 / UI 7) é exatamente o tipo de inconsistência que diligence pega. Reconciliar e publicar UMA verdade é higiene básica de produto de pagamento — por isso T1 fica no topo.

---

## Backlog completo (pontuado, agrupado por tema)

### 🔴 Backend — correção de fluxo de dinheiro

| # | Item | Arquivo:linha | Sev | Imp | Esf | Score |
|---|------|---------------|-----|-----|-----|-------|
| B1 | **Webhook idempotency "claim-before-commit"** — `markStripeEventProcessed` grava o doc ANTES do handler; falha transitória → 500 → Stripe re-tenta → doc já existe → short-circuit → handler nunca re-roda → enrollment/payout perdidos. Fix: deletar o claim no catch, ou two-phase com status (`claimed`→`done`). | `index.ts:2854-2861` + `3685-3695` ✓ | **alta** | 5 | 2 | **20** |
| B2 | **Overwrite fora de ordem** — `checkout.session.expired`/`payment_failed` chamam `markOrderStatus` incondicional; se chegarem após um pedido já `paid`, sobrescrevem o estado pago. Fix: só transicionar de estados não-terminais. | `index.ts:2878-2883` | **alta** | 4 | 2 | **16** |
| B3 | **Guard de compra duplicada não-transacional** — `enrollmentRef.get()` é leitura fora de transação; dois checkouts concorrentes (duplo-clique/duas abas) passam ambos → cobrança dupla. Fix: transação ou idempotência por `userId__courseId` em pedido in-flight. | `index.ts:1345-1356` ✓ | **alta** | 4 | 3 | **12** |

### 🟠 Verdade / Copy (diligence)

| # | Item | Arquivo:linha | Sev | Imp | Esf | Score |
|---|------|---------------|-----|-----|-----|-------|
| T1 | **Reconciliar payout (30/10/7)** — escolher o número (Q1) e alinhar TODA a copy + docs ao código. | `payment-rules.ts:12` + 5 arquivos de copy | **alta** | 5 | 1 | **25** |
| T2 | **Stubs de professor no nav** — decidir: esconder do menu na demo, ou rotular claramente "roadmap Q3 + me avise". | `app/teach/{integrations,co-productions,team,coupons}/page.tsx` | **média** | 4 | 1 | **20** |
| T3 | **`/promise` promete o não-shipado** (affiliate, analytics, quizzes, drip, custom domains) — marcar "em breve" para não virar promessa falsa. | `app/promise/page.tsx:17` | **média** | 3 | 1 | **15** |

### 🟡 Acessibilidade / WCAG

| # | Item | Arquivo:linha | Sev | Imp | Esf | Score |
|---|------|---------------|-----|-----|-----|-------|
| A1 | **Tokens de dark theme nunca trocam** (accent/success/warning/danger) — CTA primário vermelho falha AA no escuro; tema escuro inteiro degradado. | `globals.css:39-60` | **alta** | 4 | 2 | **16** |
| A2 | **Erros de auth sem `role=alert`/`aria-live`** — leitor de tela não anuncia falha de login. | `login-form.tsx` | **média** | 3 | 1 | **15** |
| A3 | **`--color-ink-muted` (#7a8fae) falha AA** em texto sobre fundo claro — usado amplamente. | `globals.css:17,1210-1212` | **média** | 3 | 2 | **12** |
| A4 | **Dropdowns (conta/sign-in) hardcodam fundo branco** sem override dark. | `globals.css:687-699,636-651` | **média** | 3 | 2 | **12** |
| A5 | **status-chip warning/success abaixo de AA.** | `globals.css:352-368` | **baixa** | 2 | 2 | **8** |

### 🟢 Receita recorrente / Conversão (motor já existe)

| # | Item | Arquivo:linha | Sev | Imp | Esf | Score |
|---|------|---------------|-----|-----|-----|-------|
| R1 | **Destravar pricing de assinatura de curso** — backend já aceita `subscription_monthly/yearly`; UI desabilita com "Coming soon". Receita recorrente quase de graça. | `course-builder-studio.tsx` (un-disable) | **média** | 4 | 2 | **16** |

### 🔵 Estados / Polish

| # | Item | Arquivo:linha | Sev | Imp | Esf | Score |
|---|------|---------------|-----|-----|-----|-------|
| P1 | **Auditoria de estados vazio/loading/erro** em `learn/*` e `teach/*` — evita o "parece quebrado" na demo. | `app/learn/*`, `app/teach/*` | **média** | 3 | 3 | **9** |
| P2 | **Redesign do theme-toggle** (#6 do fundador) — swap instantâneo → cross-fade/rotate. A11y já ok. | `components/shared/theme-toggle.tsx` | **baixa** | 2 | 2 | **8** |

### 🟣 Paridade competitiva (Skool engagement + Cakto monetização) — *refinado com evidência primária*

| # | Item | Evidência (eles têm / nós não) | Imp | Esf | Score |
|---|------|--------------------------------|-----|-----|-------|
| C1 | **Loop de gamificação MVP** (likes→pontos→9 níveis→leaderboard 7/30/all-time). | Skool: 1 like=1pt, ladder de 9 níveis (vídeo). Nós: **zero** — "likes" só em copy `capabilities-grid.tsx:36`; `grep level/leaderboard` = 0. Feed existe (`course-community-feed.tsx`) mas sem engajamento mensurável. | 5 | 3 | **15** |
| C2 | **SEO/discovery orgânico** — JSON-LD (Course/Offer) + cursos no sitemap. | Skool = "Google-indexed" (vantagem nomeada). Nós: **0 JSON-LD** (`grep schema.org/@type`=0) + `[slug]` fora do sitemap (`sitemap.ts:10-28`). Fruto baixo, aquisição orgânica grátis. | 4 | 2 | **16** |
| C3 | **Order bump no checkout** (1+ produto, 1-clique). +25% ticket (Cakto). | Encaixa no checkout atual: `line_items` é item único em `index.ts:1416`; flag via `request.data` em `createCheckoutSession` (`index.ts:1300`). | 4 | 3 | **12** |
| C4 | **Gating por nível** ("unlock chat/post/curso ao subir") — *fase 2 do C1, o "dente" da retenção*. | Skool plugins (vídeo t=01:20) + course access "Members of a certain level" (t=01:17). Amarra gamificação→monetização + mata DM-spam. Depende do C1. | 4 | 3 | **12** |
| C5 | **Discovery ranking/sort** (trending/featured/sort UI no catálogo). | Skool ordena por membros/atividade. Nós: "featured"=slice fixo dos 6 (`featured-courses.tsx:12`), sort só A→Z (`published-courses.ts:43`), sem trending. | 4 | 3 | **12** |
| C6 | **Programa de afiliados** (links, atribuição, comissão recorrente). | Skool 40% recorrente + "You were referred by…" no checkout. Nós: **0** (`grep affiliate`=0), MAS ledger+transfer Stripe reusável (`index.ts:2039-2280`); só falta atribuição + 2º leg de payout. | 5 | 4 | **10** |
| C7 | **Members directory** (roster, perfis, níveis, online). | Skool: aba Members. Nós: **stub** hardcoded (`course-community-feed.tsx:254-263`). | 3 | 3 | **9** |
| C8 | **Posts fixados + replies aninhados** no feed. | Skool: pin + threading. Nós: "announcement" é só categoria (sem pin, `grep pinned`=0); comentários single-level, "Reply" posta top-level (`course-community-feed.tsx:475`). | 3 | 3 | **9** |
| C9 | **Upsell/downsell pós-compra 1-clique** (ofertas sequenciais). | Cakto. **Exige primitive que não existe:** `paymentIntents.create`=0 hits, checkout usa `customer_email` only ("not a persistent Customer", `index.ts:2946`). Construção BE maior. | 3 | 4 | **6** |
| C10 | **Quizzes/assessment runtime**. | Skool 2025. Nós: `quiz` é tipo de lição mas runtime é placeholder (`enrolled-course-workspace.tsx:722`); sem modelo question/answer/grade. | 3 | 4 | **6** |
| C11 | **Checkout builder (drag-drop + CRO)** — editor de checkout com temas/fontes/cores, componentes de escassez/prova-social/exit-popup, e múltiplos checkouts por produto (A/B). | Cakto (ao vivo): `checkout-builder/...` drag-drop, exit-popup/notificação/chat, cronômetro/depoimento. Nós: Stripe Checkout hospedado fixo (`createCheckoutSession` `index.ts:1300`), 1 checkout/curso, zero customização. | 3 | 5 | **3** |
| C12 | **Multi-preço / multi-oferta por produto** (várias ofertas no mesmo produto). | Cakto (ao vivo): até 10 preços/ofertas por produto. Nós: 1 preço/curso, sem tabela de ofertas. | 2 | 4 | **6** |

### ⚪ Hardening (regras / storage)

| # | Item | Arquivo:linha | Sev | Imp | Esf | Score |
|---|------|---------------|-----|-----|-----|-------|
| H1 | **`courses` read torna `in_review` world-readable** — verificar se é intencional (sell-on-submit deixa `in_review` comprável; mas pode expor cursos não-listados). | `firestore.rules:1442-1450` | **baixa** | 2 | 2 | **8** |
| H2 | **`validUpload` aceita octet-stream/zip 500MB** sem cross-check com asset-doc. | `storage.rules:48-75` | **baixa** | 2 | 3 | **6** |

---

## 🏆 TOP 10 (por Score)

| Rank | # | Item | Camada | Sev | Imp | Esf | Score |
|------|---|------|--------|-----|-----|-----|-------|
| 1 | T1 | Reconciliar payout (30/10/7) + alinhar copy | Verdade | alta | 5 | 1 | **25** |
| 2 | B1 | Webhook idempotency claim-before-commit | BE money | alta | 5 | 2 | **20** |
| 3 | T2 | Stubs de professor no nav (esconder/rotular) | FE/Verdade | média | 4 | 1 | **20** |
| 4 | B2 | Overwrite de pedido pago fora de ordem | BE money | alta | 4 | 2 | **16** |
| 5 | R1 | Destravar assinatura de curso (BE pronto) | Receita | média | 4 | 2 | **16** |
| 6 | C2 | SEO JSON-LD + cursos no sitemap (discovery orgânico) | Competitivo | — | 4 | 2 | **16** |
| 7 | A1 | Tokens de dark theme nunca trocam (CTA falha AA) | A11y | alta | 4 | 2 | **16** |
| 8 | C1 | Loop de gamificação MVP (paridade Skool) | Competitivo | — | 5 | 3 | **15** |
| 9 | T3 | `/promise` — marcar não-shipado como "em breve" | Verdade | média | 3 | 1 | **15** |
| 10 | A2 | Erros de auth sem `aria-live`/`role=alert` | A11y | média | 3 | 1 | **15** |

> **Cluster de correção de dinheiro (tratar como bloco, mesmo fora do TOP 10 por score):** B1 (20) · B2 (16) · **B3 — guard de compra duplicada não-transacional (12, #11)**. Os três são severidade **alta** e tocam fluxo de caixa LIVE; B3 fica logo abaixo do corte só pelo esforço, não pela gravidade.

---

## Perguntas abertas para o fundador

1. ✅ **Payout (Q1) — RESPONDIDO 2026-06-06:** manter **30 dias** + copy honesta. **T1 executado** (docs/comentários reconciliados; UI já estava em 30).
2. **Stubs de professor (T2):** esconder os 4 do menu na demo, ou manter com rótulo "roadmap Q3 + me avise"?
3. **`/promise` (T3):** enxugar para o shipado, ou manter como visão com tag "em breve"?
4. **Assinatura de curso (R1):** habilitar já para a demo (backend pronto) ou segurar?
5. **Order bump (C3):** formato Cakto (bump único) ou múltiplos bumps? Define o desenho.
6. **Prioridade de paridade competitiva:** gamificação (retenção) primeiro, ou afiliados (aquisição) primeiro? São os dois big bets.

---

## Gate de segurança (antes de qualquer mudança que toque Stripe LIVE)

Passe dedicado, **fora** deste backlog de produto, recomendado antes de mexer no fluxo de pagamento em produção:
`testing-api-security-with-owasp-top-10` · `implementing-pci-dss-compliance-controls` · `implementing-secrets-scanning-in-ci-cd` · `integrating-dast-with-owasp-zap`.

---

## 🚦 FASE 4 — EM EXECUÇÃO (aprovado 2026-06-06). Ordem: T1 → B1 → T2 → opt(a) → B2/B3 → …

Sequência aprovada pelo fundador. Execução **um item por vez**. Em 2026-06-06 o
fundador liberou deploy (@devops pode deployar) e mandou **seguir bloco a bloco
até concluir tudo**, escolhendo o opcional mais recomendado.

| Ordem | Item | Status |
|-------|------|--------|
| 1 | **T1 — payout truth** | ✅ **CONCLUÍDO + DEPLOYADO** (2026-06-06): UI já em 30; docs/comentário reconciliados; Q1=30. |
| 2 | **B1 — webhook idempotency** (claim-before-commit) | ✅ **CONCLUÍDO + DEPLOYADO** (2026-06-06): two-phase `processing`→`done`; só short-circuita em `done`; retry reprocessa marker órfão. Lógica DI testável em `payment-rules.ts` (`claimStripeEvent`/`markStripeEventDone`/`decideStripeEventClaim`), wired em `index.ts`, função antiga removida. 5 testes de regressão + tsc + eslint limpos. |
| 3 | **T2 — stubs de professor no nav** | ✅ **CONCLUÍDO + DEPLOYADO** (2026-06-06): premissa do backlog estava **stale** — os 4 stubs já estavam fora do menu (`contexts: []`, filtro provado) e já rotulados "on the roadmap". Defeito real encontrado e corrigido: link enganoso no **Termos de Serviço**. |
| 4 | **opt(a) — "Notify me" nos painéis roadmap** | ✅ **CONCLUÍDO** (2026-06-06): opcional mais recomendado vs. opt(b) (deletar `/teach/refunds` criaria 404 p/ URL digitada; redirect gracioso é melhor). `TeacherComingSoonPanel` ganhou prop `notifyFeature` → CTA `mailto:support` por feature, convertendo dead-end de roadmap em sinal de demanda mensurável. Presentational, atrás do gate `teacherStudio.access`. Commit `d5ebdca`. |
| 5 | **B2 + B3 — overwrite fora de ordem + guard de compra duplicada** | ✅ **CONCLUÍDO** (2026-06-06): bloco de dinheiro fechado. B2: `markOrderStatus` transacional + freeze de estado terminal (`shouldApplyOrderStatusTransition`). B3: lock de checkout in-flight reivindicado **dentro de transação** (serialização OCC) + `expires_at` na sessão Stripe + release de lock com guarda de posse (`shouldReleaseCheckoutLock`). Review adversarial pegou um race de double-charge no path de takeover **antes do LIVE**; corrigido e re-verificado (SAFE-TO-DEPLOY). tsc + **106/106** vitest + eslint limpos. Commit `0ca1ecf`. |
| 6 | **C2 — SEO/discovery orgânico (JSON-LD + sitemap)** | ✅ **CONCLUÍDO + DEPLOYADO + VERIFICADO LIVE** (2026-06-07): escolhido como o item de maior ROI do bloco de paridade (fruto baixo, aquisição orgânica grátis, score 16). JSON-LD `Course` (+`Offer`) nas páginas de catálogo estático + 6 rotas `/courses/[slug]` no sitemap + dedup de `SITE_URL`. **Review adversarial pegou um furo de No-Invention (Art. IV) antes do LIVE:** a 1ª versão hardcodava `availability:InStock` sempre que havia preço — o `Offer` foi **gateado por `purchasable`**, derivado do **mesmo `getCourseAccessDecision`** que o CTA renderiza, garantindo paridade structured-data ↔ conteúdo visível em ambas direções. tsc + **115/115** vitest (incl. regressão purchasable=false) + eslint limpos. Commit `7e7db0c`. |
| 7 | **T3 — `/promise` promete o não-shipado** | ✅ **CONCLUÍDO + DEPLOYADO + VERIFICADO LIVE** (2026-06-07): commit anterior `257ff4c` já tinha tirado custom-domains/analytics/affiliate do "feature parity", mas **manteve quizzes** alegando "verified live" — verificação independente provou que era **falso**: `quiz` é um `LessonType` selecionável (`learning.ts:8`, `teacher-course.ts:46`), mas o lado do aluno é stub (`enrolled-course-workspace.tsx:722`: "Quiz questions and passing rules will appear here **when assessment tools are connected**") — zero UI de quiz-taking/grading/passing-rules. Removido "quizzes" do promise #02; certificates/drip/community **verificados shipped** (ficam). Quiz builder é **latente** (flag `teacherStudio.courseBuilder` off em prod, sem override) → sem impacto live em aluno hoje. LIVE: `/promise` sem nenhum "quiz". Commit `49a4e29`. |

### T2 — registro técnico (2026-06-06)

- **Premissa do backlog ("stubs no nav / esconder do menu") era stale.** Prova: `platform-nav.tsx:64-68` filtra por `item.contexts.includes(context)` e `context ∈ {learner,teacher,ops}` (nunca vazio). Os 5 itens com `contexts: []` em `site.ts` (`coupons:141`, `co-productions:149`, `refunds:157`, `team:165`, `integrations:173`) → `[].includes(...)` = `false` → **nunca renderizados no nav**. "Esconder do menu" já era verdade.
- **Stubs já honestos:** os 4 (`integrations`/`co-productions`/`team`/`coupons`) renderizam `TeacherComingSoonPanel` sob `ProtectedSurface` (gate `teacherStudio.access`), com texto "on the roadmap" + CTA real ("Manage payouts" → `/account/payments`). Alcançáveis só por URL direta; **zero `<Link>`** aponta para eles. Mudá-los seria **inventar trabalho** → mantidos como estão.
- **Defeito real (corrigido):** `legal/terms/page.tsx:103-106` afirmava *"Educator payout and refund handling is described in the **educator refund policy**"* linkando `/teach/refunds` — que **não é página de política**, é `redirect("/account/payments")` (auth-gated). Um visitante deslogado lendo os Termos clicava e batia num login, não numa política. **Fix:** repontado para `/fees-and-payouts` (página **pública**, descreve refund window 7d + payout clearance 30d + fees + disputes) e relabel para "fees and payouts policy". Agora `/teach/refunds` tem **zero links inbound** (só a entrada hidden em `site.ts:154`).
- **Verificação:** grep confirma 0 links para os 4 stubs e 0 links para `/teach/refunds` fora da entrada hidden · `eslint src/app/legal/terms/page.tsx` ✅.
- **Aberto (opcional, fundador) — RESOLVIDO:** (a) ✅ **feito** (ordem 4): "Notify me" via `mailto` é um sinal de demanda honesto, não uma promessa de feature — escolhido como o opcional mais recomendado; (b) deletar a rota órfã `/teach/refunds` — **descartado**: o redirect gracioso evita 404 para URL digitada/indexada, melhor que remover (decisão B do demo-readiness mantida).

### B1 — registro técnico da correção (2026-06-06)

- **Bug:** `markStripeEventProcessed` gravava o marker ANTES do handler. Falha transitória → 500 → Stripe re-tenta o mesmo `event.id` → marker já existe → short-circuit como "duplicate" → handler nunca re-roda → **enrollment/payout perdidos para sempre**.
- **Pré-requisito verificado:** os **5 handlers** que um reprocesso pode tocar são idempotentes — `handleCheckoutCompleted` (writes merge/update; enrollment guardado por `if (!exists)`), `handleChargeRefunded` (reversal com `idempotencyKey` estável `..._${charge.id}_${charge.amount_refunded}` + `alreadyReversed` lido do ledger commitado → nunca dobra), `markOrderStatus`/`syncSubscriptionFromStripe`/`handleInvoicePaymentFailed` (puro `set(merge)`). Reprocessar é seguro; único artefato é linha de auditoria/analytics duplicada (cosmético). **Nenhum dinheiro se move neste handler** — o transfer real é o cron `dailyReleaseTransfers` em D+30, muito depois da janela de retry da Stripe (~3 dias).
- **Fix:** two-phase. Claim grava `status:"processing"`; promoção a `status:"done"` **só após** todos os handlers rodarem sem throw; short-circuit **apenas** em `done`. Marker preso em `processing` (throw ou crash entre claim e completion) é reprocessado no retry.
- **Arquivos:** `payment-rules.ts` (+`claimStripeEvent`, `markStripeEventDone`, `decideStripeEventClaim`, tipos `StripeEventMarkerRef`/`StripeEventMarkerStatus`/`StripeEventClaimDecision`); `index.ts` (import + handler claim/complete + remoção da `markStripeEventProcessed`); `payment-rules.test.ts` (+5 testes, incl. o guard exato da regressão "retry após falha = reprocessa, não duplicate").
- **Verificação:** `npm --prefix functions run build` (tsc) ✅ · `vitest run` 97/97 ✅ · `eslint` (3 arquivos) ✅.

### B2 + B3 — registro técnico da correção (2026-06-06)

- **B2 (overwrite fora de ordem).** Stripe não garante ordem de entrega: um `checkout.session.expired`/`payment_failed` de uma tentativa antiga pode chegar **depois** do `checkout.session.completed` já ter marcado `paid`, revogando uma compra real. **Fix:** `markOrderStatus` agora roda em `db.runTransaction` e congela estados terminais (`paid`/`refunded`/`partially_refunded`) via `shouldApplyOrderStatusTransition` (puro, testado). O read do pedido precede todo write na transação.
- **B3 (compra duplicada não-transacional).** `enrollmentRef.get()` é leitura fora de transação; dois checkouts concorrentes (duplo-clique/duas abas) passavam ambos → cobrança dupla. **Fix:** lock `checkoutLocks/${userId}__${courseId}` reivindicado **dentro de uma transação** — a concorrência otimista do Firestore serializa: exatamente um vencedor segue, perdedores re-leem o claim fresco e resolvem para `reuse` (devolve a MESMA url de sessão) ou `wait`. Decisão pura em `decideCheckoutLock` (testada); a serialização é propriedade da transação.
- **Race pego pelo review adversarial (antes do LIVE).** A primeira versão re-reivindicava o lock no path de *takeover* com `.set({merge:true})` — que **não** falha quando o doc existe, logo dois deciders de takeover sobre um lock stale ambos seguiam para `stripe.checkout.sessions.create` → **double charge**. Movido para dentro da transação (o doc do lock entra no read-set → o perdedor aborta, re-tenta e cai em `wait`/`reuse`). Re-verificado por um segundo agente adversarial: **SAFE-TO-DEPLOY**, sem race residual.
- **Hardening do mesmo review:** (1) a sessão Stripe agora seta `expires_at` (~31 min) para que o `sessionTtlMs` do lock (35 min) seja **honesto** — um takeover nunca corre contra uma sessão ainda pagável (antes, sem `expires_at`, a sessão real vivia ~24h); na expiração o `checkout.session.expired` cancela o pedido e libera o lock. (2) release de lock (em `markOrderStatus` **e** `handleCheckoutCompleted`) é guardado por `shouldReleaseCheckoutLock(lock.orderId === orderId)` — um evento terminal tardio de uma tentativa **antiga** nunca derruba o lock de uma **re-compra viva**. (3) o cron `expireStalePendingOrders` roteia por `markOrderStatus`, herdando o freeze e o release com guarda de posse (sem locks órfãos).
- **Arquivos:** `payment-rules.ts` (+`shouldReleaseCheckoutLock`); `index.ts` (`createCheckoutSession` lock transacional + `expires_at`; `markOrderStatus` transacional + guarda de posse; `handleCheckoutCompleted` release guardado; cron via `markOrderStatus`); `payment-rules.test.ts` (+3 testes de posse, incl. o path exato "evento de A não derruba lock de B").
- **Verificação:** `npm --prefix functions run build` (tsc) ✅ · `vitest run` **106/106** ✅ · `eslint .` ✅ · review adversarial 3-lentes (`fix-first`) → fixes aplicados → re-review (`SAFE-TO-DEPLOY`).

### C2 — registro técnico da correção (2026-06-07)

- **Objetivo.** Skool ostenta "Google-indexed" como vantagem. Nós tínhamos **0 JSON-LD** (`grep schema.org/@type`=0) e as páginas `/courses/[slug]` **fora do sitemap**. C2 fecha os dois: dados estruturados `schema.org/Course` para rich results + as 6 rotas de curso no sitemap, tudo build-time/SSR (só catálogo estático; cursos de criador resolvem client-side, fora de escopo sem Admin SDK).
- **Furo de No-Invention pego pelo review adversarial (antes do LIVE).** A 1ª versão emitia `Offer` com `availability:"https://schema.org/InStock"` sempre que `priceAmountMinor` fosse numérico — **independente** de o checkout estar ligado. Se o flag `payments.checkout` estivesse off, o card mostraria "Checkout opening soon" enquanto o JSON-LD diria InStock → mismatch structured-data ↔ conteúdo (penalidade Google + overclaim Art. IV). **Fix:** `buildCourseJsonLd(course, { purchasable, siteUrl? })`; o `Offer` só é emitido quando `purchasable` — derivado do **mesmo `getCourseAccessDecision(course, isPublicFeatureEnabled("payments.checkout"))`** que o `CourseEnrollmentCta` renderiza. Fonte única de verdade → paridade por construção, nas duas direções.
- **Achado de produção (evidência > suposição).** A verificação LIVE provou que `payments.checkout` está **ligado** no build de produção: os 3 cursos pagos auto-matriculáveis (leadership 149.00, mental-health 49.00, communication 79.00) emitem `Offer InStock` — **verdadeiro**, checkout está vendendo de verdade (valida retroativamente a urgência do fix B2/B3). Os 3 não-abertos/sem-preço (clinical-psychology, hr-management, project-management) emitem **zero `Offer`** — corretamente gateados.
- **Sem invenção de campo:** sem `aggregateRating`/`review` (catálogo não tem nota) e sem `hasCourseInstance` (`durationLabel` é texto livre "8-12 weeks", não ISO-8601). `inLanguage:"en"` documentado como default site-wide (não há campo de idioma por curso). Imagem relativa absolutizada; `<` escapado no `<script>` (XSS-safe).
- **Arquivos:** `src/lib/seo/course-jsonld.ts` (novo, builder gateado); `src/components/seo/json-ld.tsx` (novo, componente `<script ld+json>`); `src/app/courses/[slug]/page.tsx` (computa `purchasable` server-side + renderiza `JsonLd`); `src/app/sitemap.ts` (6 rotas de curso via `getCourseSlugs`); `src/app/robots.ts` + `src/app/sitemap.ts` (importam `SITE_URL` de `page-metadata`, dedup); `src/lib/seo/page-metadata.ts` (`export const SITE_URL`); `src/lib/seo/course-jsonld.test.tsx` (novo, 9 testes incl. regressão purchasable=false).
- **Verificação:** tsc ✅ · `vitest run` **115/115** ✅ · `eslint` (5 arquivos) ✅ · deploy `npm run deploy:app` (SSR `ssrskillsetusaofficial` atualizado, hosting released) ✅ · **LIVE**: `sitemap.xml`=200 com 6 rotas de curso, `robots.txt`=200 com Sitemap+Host, 6 páginas de curso=200 cada com exatamente 1 bloco `Course`, Offers presentes só nos 3 purchasable (parity sem violação).

### T3 — registro técnico da correção (2026-06-07)

- **Premissa parcialmente stale.** O backlog (`promise/page.tsx:17`) apontava 5 features não-shipadas no "feature parity": affiliate, analytics, quizzes, drip, custom domains. O commit `257ff4c` (anterior a esta sessão) **já tinha removido custom-domains, analytics e affiliate** — mas **manteve quizzes, drip e community/certificates** afirmando "all verified live". Re-verifiquei essa afirmação (No-Invention: não confiar, conferir).
- **Verificação feature-por-feature:** **certificates** — shipped (funcs `issueSkillsetCertificate`/`verifySkillsetCertificate` + `domain/certificate.test.tsx`). **drip content** — shipped end-to-end (`domain/drip-policy.ts`, 5 estratégias, `getLessonUnlockState`; wired no teacher `course-builder-studio.tsx` **e** no learner `enrolled-course-workspace.tsx`). **community** — shipped (surface extensa `/learn/community/*`, feed, moderação). **quizzes** — **NÃO funcionalmente shipped**: `quiz` é `LessonType` selecionável no builder, mas o learner renderiza placeholder (`enrolled-course-workspace.tsx:722`: "...when assessment tools are **connected**"). Nota: video/text/etc. dizem "when the instructor attaches/publishes" (feature pronta, aguarda conteúdo) — quiz é o único que admite que a **tooling** não existe.
- **Fix:** removido só "quizzes" do promise #02, consistente com como `257ff4c` tratou os outros não-shipados. Texto final: "...locking certificates, drip content, or community."
- **Reachability do dead-end de quiz (avaliada, latente):** `getPublicFeatureFlagOverrides()` (`feature-flags/index.ts:187-200`) só faz override de `payments.checkout` via `NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED`. **Não há override** para `teacherStudio.courseBuilder` (`defaultEnabled:false`) → sempre off em prod → **nenhum criador alcança o builder** → nenhum aluno bate no placeholder de quiz hoje. `/promise` era a **única** superfície pública live anunciando quizzes (grep confirmou: nenhuma outra página de marketing menciona quiz).
- **⚠️ Gap conhecido para o futuro (founder):** quando `teacherStudio.courseBuilder` for ligado, a opção "quiz" do builder (`lesson-content-modal.tsx:67`, `course-builder-studio.tsx:252`) precisa ser **terminada (assessment tooling)** ou **escondida** — senão um criador autora um quiz que vira placeholder para o aluno. Não é defeito live hoje; é pré-condição do lançamento do teacher studio.
- **Verificação:** tsc ✅ · `eslint src/app/promise/page.tsx` ✅ · 5/5 testes de página (`marketing` + `platform-pages`) ✅ · deploy `npm run deploy:app` ✅ · **LIVE**: `/promise` sem nenhum substring "quiz".
