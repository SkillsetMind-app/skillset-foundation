# Auditoria Completa — Skillset Mind (2026-07-07)

> Revisao multi-agente: 6 dimensoes (rotas/acesso, pagamentos, backend, dados/RLS, frontend/UX, CEO/launch), 35 agentes, cada achado verificado por um 2o revisor independente. Gate do repo no momento: tsc 0, eslint 0, vitest 136/136.

## Sintese Executiva

# RELATÓRIO EXECUTIVO — Skillset Mind: Prontidão pra Vender

**Data:** 2026-07-06 · **Base:** 6 dimensões auditadas, 40+ achados verificados independentemente · **Contexto:** pré-launch, zero clientes, pagamentos dormentes

---

## 1. VEREDITO GERAL

**A plataforma está a dias de vender — não por falta de código, mas por config founder-gated + 3 bugs de dinheiro que precisam morrer antes do primeiro ciclo de refund.**

A arquitetura de dinheiro é sólida e bem construída (preço server-side, webhook idempotente, hold de 30 dias com claim atômico). O que bloqueia a 1ª venda é rotação de chave vazada, secrets do Stripe e onboarding Connect. O que bloqueia um launch *seguro* são os bugs P1 abaixo — todos com fix mapeado e barato.

**Saúde por dimensão:**

| Dimensão | Estado | 1 linha |
|---|---|---|
| Rotas & Acesso | SAUDÁVEL | 18 rotas com auth antes de agir, service-role protegida, 503 dormente consistente — só acabamento (2 P2, 4 P3). |
| Pagamentos | NÚCLEO SÓLIDO, 3 FUROS | Checkout/webhook/split corretos, mas clawback pós-release está MORTO, recompra pós-refund cobra sem entregar, e chargeback não congela payout. |
| Backend | DISCIPLINADO, MAPPERS STALE | Camada de dados consistente, porém 3 mappers mentem sobre dinheiro/cobrança na UI e o webhook confunde erro-de-leitura com linha-ausente. |
| Dados (RLS/schema) | ACESSO EXCELENTE, DR DESCOBERTO | RLS deny-by-default bem feita, zero P0 — mas só 2 de 28 migrations estão no git e faltam CHECKs de dinheiro. |
| Frontend/UX | ACIMA DA MÉDIA | Loading/empty/error em tudo, modais APG — os 2 problemas sistêmicos são i18n meio-EN e flash de dark mode. |
| CEO/Launch | CÓDIGO PRONTO, CONFIG PENDENTE | O que trava a venda é founder-gated: rotação de chave, secrets Stripe, Connect do professor, verificação de Auth URL. |

---

## 2. CAMINHO CRÍTICO ATÉ A 1ª VENDA REAL

Duas pistas: o que faz a venda **acontecer** e o que faz a venda ser **segura**.

### Pista A — Para a venda ACONTECER (100% founder, ~1-2h de dashboard)

Ordem obrigatória:

1. **Rotacionar a service_role do Supabase** (P0 — chave vazou em transcript 2026-07-02, banco considerado comprometido até rotacionar). Dashboard → Settings → API → Reset. Atualizar `SUPABASE_SERVICE_ROLE_KEY` (e anon key se o JWT secret girar junto) no Vercel → redeploy → confirmar que a chave antiga retorna 401. **Nada mais importa antes disso.** ~10 min.
2. **Setar secrets Stripe LIVE no Vercel:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CRON_SECRET`. Criar o webhook no dashboard Stripe apontando pra `https://skillsetmind.com/api/webhooks/stripe` com os 11 eventos (usar SÓ o doc `docs/plans/2026-07-04-COMO-LIGAR-passo-a-passo.md` — o `STRIPE_CHECKLIST.md` da raiz é da era Firebase e aponta pra URL morta; vou deletá-lo). ~30 min.
3. **Verificar Supabase Auth URL config** (NEEDS_HUMAN P1): Site URL = `https://www.skillsetmind.com`, allowlist de redirects com os dois domínios, e conferir qual template de email de confirmação está ativo. Sem isso o funil de professor (que exige email verificado) pode quebrar inteiro. ~10 min + 1 signup de teste fim-a-fim.
4. **Completar o onboarding Stripe Connect Express do professor** (KYC/banco em `/account/payments` até mostrar Connected). O checkout recusa venda de professor sem Connect — com 0 contas conectadas, o teste de $1 falha deterministicamente. Este passo está AUSENTE do COMO-LIGAR (vou adicionar). ~15 min.
5. **Compra-teste de $1** → conferir webhook, enrollment ativo, ledger `in_release` com `release_at` +30d.

Secundário (não bloqueia venda de curso, bloqueia upsell de plano): **verificar no dashboard Stripe LIVE se os 6 price IDs de Starter/Pro/Plus existem em live-mode** (NEEDS_HUMAN P2) — price ID de test-mode passa pelo guard e quebra o upgrade com "No such price".

### Pista B — Para a venda ser SEGURA (código, eu faço)

Estes 3 bugs P1 são determinísticos assim que houver dinheiro + refund. Fecham **antes** de divulgar, idealmente antes do teste de $1:

- **Clawback pós-release morto:** todo refund emitido depois do payout devolve o dinheiro ao comprador SEM reverter o transfer do professor — perda silenciosa da plataforma, 100% dos casos.
- **Recompra pós-refund:** aluno reembolsado que compra de novo é cobrado, o professor entra na fila de repasse, e o acesso NUNCA volta (upsert `ignoreDuplicates` não reativa enrollment `refunded`). Cobrança sem entrega = exposição legal.
- **Chargeback não tratado:** disputa de cartão debita a plataforma e o payout ao professor sai mesmo assim (o cron só olha `in_release`; disputa não congela nada). Vetor clássico de fraude.

Mais dois pré-requisitos de operação segura: **webhook parar de engolir erro de leitura** (refund pode ser marcado como processado sem gravar nada) e **versionar o schema** (`supabase db pull` — hoje 26 de 28 migrations vivem só no banco; a camada de segurança inteira é RLS e não está no git).

---

## 3. PLANO PRIORIZADO P0 → P3

**Legenda:** [F] = só o fundador · [C] = eu executo sozinho · [C+F] = eu executo, fundador destrava (token/aprovação)

### P0 — AGORA (bloqueia tudo)

| # | Ação | Esforço | Quem |
|---|---|---|---|
| 1 | Rotacionar service_role + atualizar Vercel + smoke test 401 na chave antiga | 10 min | [F] |

### P1 — Antes de dinheiro real (esta semana)

| # | Ação | Esforço | Quem |
|---|---|---|---|
| 2 | Clawback pós-release: corrigir predicado de `shouldReverseReleasedPayout` (rules.ts) + suite de testes `.test.tsx` | 1-2h | [C] |
| 3 | Recompra pós-refund: espelhar em `handleCheckoutCompleted` o padrão select/insert/update do branch de assinatura + teste | 1h | [C] |
| 4 | Disputes: adicionar `charge.dispute.created/closed` — freeze do ledger em `disputed`, won→`in_release`, lost→refund total com clawback | 2-3h | [C] |
| 5 | Webhook: destruturar `error` e lançar nos 6 sites de leitura que decidem dinheiro/acesso (deixar Stripe redelivrar) | 30 min | [C] |
| 6 | Mapper `payout-ledger.ts`: mapear colunas reais (carteira do professor hoje superestima líquido e erra refunds) + teste | 45 min | [C] |
| 7 | Mapper `course-subscriptions.ts`: mapear cancel_at_period_end etc. (botão Resume hoje é inalcançável) + teste | 45 min | [C] |
| 8 | Guard Connect na RPC `submit_teacher_course_for_review` (migration) + CTA no builder — curso pago não pode ir pro catálogo sem Connect do professor | 1-2h | [C] |
| 9 | Schema no git: `supabase db pull` + commit das 28 migrations + policies de storage + pg_cron espelhado | 30 min | [C+F] (precisa de access token) |
| 10 | i18n: lançar EN-only — remover fallback Accept-Language + ocultar LocaleSwitcher (~5 linhas). Completar PT/ES fica pra depois do launch | 20 min | [C] (decisão: [F]) |
| 11 | Verificar Auth URL config + template de email no dashboard Supabase | 15 min | [F] |

### P2 — Semana do launch / antes de escalar

| # | Ação | Esforço | Quem |
|---|---|---|---|
| 12 | Portar suite de 719 linhas de testes de dinheiro deletada com `functions/` (arquivo vivo é byte-idêntico; porta 1:1) + remover glob morto do vitest | 45 min | [C] |
| 13 | Guards de refund pré-fulfilment no webhook (2 interleavings) + teste | 1-2h | [C] |
| 14 | TOCTOU do cron: guarda otimista `.eq("refunded_amount_minor", ...)` no claim | 15 min | [C] |
| 15 | Idempotency key do refund parcial admin: incluir `alreadyRefundedMinor` na key | 20 min | [C] |
| 16 | Rate limit em `/api/teach/video/create` (padrão RPC do advisor vizinho) — obrigatório ANTES de ligar o Bunny | 20 min | [C] |
| 17 | Migration de CHECK constraints nas colunas de dinheiro (bounds corrigidos: refunded ≤ gross, não ≤ transfer) | 1h | [C] |
| 18 | Fila de revisão admin: remover filtro realtime `status=eq.in_review` (padrão já existe no mesmo arquivo) | 10 min | [C] |
| 19 | Deduplicar `rowToUserProfile` (admin-users → user-mappers) | 20 min | [C] |
| 20 | Dark mode: script inline no layout + suppressHydrationWarning + init fixo no provider | 45 min | [C] |
| 21 | Docs: deletar STRIPE_CHECKLIST.md obsoleto + adicionar "Passo 5 — Connect do professor" ao COMO-LIGAR | 15 min | [C] |
| 22 | Verificar 6 price IDs em live-mode no dashboard Stripe | 10 min | [F] |
| 23 | Imposto: registrar decisão US-first sem Stripe Tax em DECISIONS.md com trigger de revisão (>N vendas internacionais) | 10 min | [C] (decisão: [F]) |
| 24 | Supabase Pro/backup diário antes de volume real | 5 min | [F] |

### P3 — Higiene (batch único, ~3h, tudo [C])

Comparação constant-time do CRON_SECRET · cap de 16KB no `/api/csp-report` · hash do IP em certificates/verify · fee duplicada (rules.ts vs payment-split.ts, unificar) · `platformFeeBps` '0' falsy no fallback de invoice · código morto Firebase em rules.ts/client.ts/feature-flags · ramo INSERT do `users_field_guard` (migration) · policy SELECT de `subscriptions` (ou documentar server-fetch) · a11y: Ctrl+K morto, tooltip do pricing sem foco, HorizontalTabs sem setas, status enum cru no dashboard do aluno, skeleton sem live region.

**Estimativa total do que eu faço sozinho: ~2-3 dias de trabalho focado.** O caminho founder inteiro cabe em ~2h de dashboard.

---

## 4. O QUE JÁ ESTÁ SÓLIDO (confiança merecida)

- **Preço 100% server-side** — cliente só manda `courseId`; adulteração de preço é impossível por construção.
- **Webhook Stripe:** assinatura verificada em raw body, idempotência em 2 fases com claim correto, 11 eventos, lock contra cobrança dupla.
- **Motor de repasse:** claim atômico, idempotency keys estáveis, hold de 30 dias, reversal da corrida refund-durante-release já implementado.
- **Controle de acesso:** RLS deny-by-default com backstops em 3 camadas (policies + column guards BEFORE UPDATE + RPCs SECURITY DEFINER com `skillset.trusted_write`). O furo refunded/revoked-lê-conteúdo-pago já foi fechado em sessão anterior. Advisor: 0 ERROR.
- **Rotas:** todas as 18 confirmam identidade antes de agir, input validado com caps, service-role nunca vaza pro cliente, degradação 503 dormente consistente.
- **AI trust-boundary:** os 2 proxies n8n com segredo fail-closed + rate limit em 2 janelas + sanitização.
- **Frontend acima da média pra pré-launch:** loading/empty/error em todas as superfícies, focus-trap APG nos modais, erros com aria-live, forms de auth exemplares, embed de vídeo saneado (lesson-embed é exemplar).
- **Legal preenchido** (entidade, lei de NY, refund 7d), refund policy self-serve, fila de revisão de cursos, audit_log em ações de admin.
- **Gate do repo verde:** tsc 0, eslint 0, vitest 136/136.

**Resumo em uma frase:** o motor está bem construído e o tanque está vazio de propósito — rotacione a chave, abasteça os secrets, conecte o professor, e me dê 2-3 dias pra fechar os furos de refund antes do dinheiro de verdade circular.

---

## Anexo — Todos os achados confirmados (por severidade)

| Sev | Dimensao | Achado | Arquivo | Fix |
|-----|----------|--------|---------|-----|
| P0 | ceo-launch | service_role do Supabase vazada (2026-07-02) e sem evidencia de rotacao — bloqueador de launch antes de dinheiro real | docs/plans/2026-07-04-security-hardening-founder-checklist.md | Acao do founder (dashboard, ~5 min, fazer ANTES de setar STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET): 1) Supabase dashboard -> Project Settings -> API -> Service role -> Reset/Rotate. Atencao: se o proje |
| P1 | backend | Mapper de course_subscriptions descarta cancel_at_period_end/current_period_end/interval/past_due — card nunca confirma cancelamento e resume é inalcançável | src/lib/data/course-subscriptions.ts | Em rowToCourseSubscription, mapear os campos reais do row e remover o cast e o comentário falso: return { id: row.id, userId: row.user_id, courseId: row.course_slug ?? row.course_id ?? "", teacherId:  |
| P1 | backend | Mapper de payout_ledger stale vs schema: carteira do professor superestima líquido (ignora taxa Stripe) e erra refunds parciais | src/lib/data/payout-ledger.ts | Em rowToPayoutLedgerEntry (src/lib/data/payout-ledger.ts:9-36), mapear as colunas reais em vez de recalcular/cravar undefined: grossAmountMinor: row.gross_amount_minor; skillsetFeeMinor: row.skillset_ |
| P1 | backend | Webhook charge.refunded engole erro de leitura do Supabase e marca o evento como done — refund some para sempre | src/app/api/webhooks/stripe/route.ts | Nas leituras dos handlers do webhook cuja semantica de "ausente" decide dinheiro/acesso, destruturar `error` e lancar: `const { data: payment, error } = await ...; if (error) throw new Error(error.mes |
| P1 | ceo-launch | Curso pago pode ser publicado (sell-on-submit) sem o professor ter Stripe Connect — comprador bate em beco sem saida no checkout | src/app/api/payments/checkout/route.ts (guard 111-126) + RPC submit_teacher_course_for_review (so no DB; grant em supabase/migrations/20260704_tighten_content_access_and_rpc_grants.sql:62) | Fix na raiz (todos os clientes passam por ela): na RPC submit_teacher_course_for_review, dentro do bloco payment_type <> 'free', adicionar guard lendo public.users do owner — se stripe_connected_accou |
| P1 | ceo-launch | Re-compra pos-refund cobra o aluno mas o enrollment fica 'refunded' — acesso nunca volta | src/app/api/webhooks/stripe/route.ts | Em handleCheckoutCompleted, substituir o upsert das linhas 221-237 pelo mesmo padrao do handler de assinatura (linhas 395-427): (a) select status de enrollments por id `${userId}__${courseId}`; (b) se |
| P1 | ceo-launch | Schema de producao praticamente nao versionado: 2 migrations no repo vs banco inteiro aplicado via MCP — DR de plataforma de dinheiro descoberto | supabase/migrations | 1) Rodar `supabase db pull` com o projeto linkado (precisa de access token — o MCP desta maquina nao tem) e commitar o snapshot em supabase/migrations. Atencao: o pull default cobre so o schema public |
| P1 | dados | Schema drift: repo holds only 2 of 28 migrations — prod schema not reproducible from git | supabase/migrations/ | Tornar o git fonte de verdade em 3 passos baratos: (1) `supabase link --project-ref ijtikldtjvsbtwszokvs` + `supabase db pull` para materializar o schema aplicado; como os 2 arquivos locais não usam t |
| P1 | frontend-ux | i18n incompleto: switcher + auto-detecção prometem PT/ES mas superfícies primárias (marketplace, pricing, help, player, checkout, erros de auth, cookies) são hardcoded EN | src/lib/i18n/server.ts (raiz da decisão); superfícies: src/components/courses/course-marketplace.tsx, src/app/pricing/page.tsx, src/components/help/help-center.tsx, src/components/learn/enrolled-course-workspace.tsx, src/components/account/embedded-checkout-panel.tsx, src/lib/auth/supabase-auth.ts, src/components/site/cookie-consent.tsx | Decisão de produto, duas rotas: (a) COMPLETAR — adicionar namespaces courses/pricing/help/checkout/player/cookies aos 3 dicionários em src/data/i18n/ e converter as superfícies para t(); trocar getAut |
| P1 | pagamentos | Clawback de refund pos-release nunca executa: status e sobrescrito antes do gate status === 'released' | src/app/api/webhooks/stripe/route.ts (linhas 640-649 e 689-699) + src/lib/payments/rules.ts:297-307 | Correcao de causa-raiz em shouldReverseReleasedPayout (rules.ts:297-307): trocar o predicado de status === 'released' para ['released','refunded','partially_refunded'].includes(status) && Boolean(inpu |
| P1 | pagamentos | Recompra apos refund cobra o aluno mas nao devolve o acesso: upsert de enrollment com ignoreDuplicates nunca reativa status 'refunded' | src/app/api/webhooks/stripe/route.ts:221-237 | Espelhar em handleCheckoutCompleted o padrao ja usado no branch de assinatura (route.ts:396-427): select do enrollment por id (`${userId}__${courseId}`); se ausente, insert com status 'active' e sourc |
| P1 | pagamentos | charge.dispute.* nao tratado: chargeback debita a plataforma e o payout ao professor sai mesmo assim | src/app/api/webhooks/stripe/route.ts | Adicionar charge.dispute.created e charge.dispute.closed a HANDLED_STRIPE_EVENT_TYPES e implementar: (a) created -> resolver o ledger via dispute.payment_intent (mesmo join de handleChargeRefunded: pa |
| P2 | backend | Fila de revisão de cursos (admin) não remove o curso após aprovar — filtro realtime status=eq.in_review não dispara na transição de saída | src/lib/data/teacher-courses.ts | Em subscribeToCoursesInReview (src/lib/data/teacher-courses.ts:322-336), remover a linha `filter: "status=eq.in_review",` do objeto de opções do postgres_changes, passando a assinar a tabela inteira e |
| P2 | backend | Testes das regras de dinheiro deletados com functions/ — rules.ts roda sem cobertura e o glob morto no vitest.config mascara o gap | vitest.config.ts:10 + src/lib/payments/rules.ts | 1) Portar a suite: `git show 28e99af^:functions/src/payment-rules.test.ts > src/lib/payments/rules.test.tsx` e trocar o import de "./payment-rules" para "./rules" (o arquivo-alvo é idêntico, porta 1:1 |
| P2 | backend | rowToUserProfile duplicado com drift comportamental entre admin-users.ts e user-mappers.ts | src/lib/data/admin-users.ts | Deletar o rowToUserProfile local de admin-users.ts (linhas 17-55) e importar { rowToUserProfile } de "@/lib/supabase/user-mappers" (mesmo padrão já usado por src/lib/data/user-profiles.ts:19-24). Remo |
| P2 | ceo-launch | 1a venda exige onboarding Express do professor — passo ausente do COMO-LIGAR; ativacao do Connect na plataforma ja verificada como feita | docs/plans/2026-07-04-COMO-LIGAR-passo-a-passo.md | Adicionar ao COMO-LIGAR, entre o PASSO 4 (redeploy) e o teste de $1, um "PASSO 5 — Conectar o recebimento do professor": (1) logado como professor, abrir https://skillsetmind.com/account/payments e co |
| P2 | ceo-launch | Checkout sem tratamento de imposto (automatic_tax ausente) — exposicao fiscal cresce com venda internacional | src/app/api/payments/checkout/route.ts | Nao bloquear launch. (1) Registrar em DECISIONS.md a decisao de lancar US-first sem coleta de imposto, com trigger de revisao (ex.: primeiro mes com >N vendas fora dos EUA ou GMV internacional > $X).  |
| P2 | ceo-launch | STRIPE_CHECKLIST.md na raiz e da era Firebase e manda configurar o webhook numa URL morta — manual operacional conflitante na trilha do dinheiro | STRIPE_CHECKLIST.md | Deletar STRIPE_CHECKLIST.md da raiz (git rm) ou substituir o conteudo inteiro por um aviso de 2 linhas: 'OBSOLETO (era Firebase, 2026-05-19). Manual atual de go-live Stripe: docs/plans/2026-07-04-COMO |
| P2 | dados | Money/ledger columns lack CHECK invariants (no DB backstop against over-refund/over-reversal) | supabase/migrations/ (schema vivo: public.orders, public.payments, public.payout_ledger — sem DDL no repo) | Migration versionada no repo (supabase/migrations/) com CHECKs de backstop — CORRIGINDO o bound errado do fix original: (1) orders: CHECK (refunded_amount_minor >= 0 AND refunded_amount_minor <= amoun |
| P2 | frontend-ux | Dark mode: flash de tema em todo page-load + hydration mismatch (useState lê localStorage no initializer) | src/lib/theme/theme-provider.tsx:48 (+ src/app/layout.tsx:49, src/components/shared/theme-toggle.tsx:11) | 1) Adicionar script inline bloqueante no <html> do root layout (src/app/layout.tsx) que lê localStorage('skillset_theme') e matchMedia('(prefers-color-scheme: dark)') e seta document.documentElement.d |
| P2 | pagamentos | TOCTOU no cron de payout: refund parcial entre o SELECT do batch e o claim congela planned_transfer_amount_minor obsoleto — professor recebe o net integral sem clawback | src/app/api/cron/release-payouts/route.ts | Fix minimo (1 linha, preserva o invariante freeze-once que protege a idempotency key do Stripe): adicionar guarda otimista ao UPDATE de claim em claimLedger — .eq("refunded_amount_minor", ledger.refun |
| P2 | pagamentos | charge.refunded pre-fulfilment engolido e marcado 'done' — refund perdido, retry do fulfilment agenda payout integral de venda reembolsada | src/app/api/webhooks/stripe/route.ts | Dois guards complementares (ambos necessarios, cobrem interleavings distintos): (1) em handleChargeRefunded, quando nem payments nem ledger existem, recuperar o PaymentIntent (charge.payment_intent) e |
| P2 | rotas-acesso | POST /api/teach/video/create sem rate limit — unica rota mutante/billable sem throttle | src/app/api/teach/video/create/route.ts | Adicionar throttle antes do ownership gate (route.ts, apos linha 20). Detalhe que o revisor original nao notou: enforceRateLimit de @/lib/payments/server/auth lanca PaymentError(429), mas esta rota na |
| P2 | rotas-acesso | Refund parcial do admin: idempotency key colide para dois parciais do mesmo valor — segundo refund silenciosamente nao acontece | src/app/api/payments/refunds/admin/route.ts | Na key de parcial (linha 117), incluir o snapshot ja disponivel de refunded_amount_minor: `admin_refund_${orderId}_${amountMinor}_${alreadyRefundedMinor}` (alreadyRefundedMinor ja e lido na linha 91;  |
| P3 | backend | Código morto do Firebase em rules.ts + glob de teste morto + comentário stale em client.ts | src/lib/payments/rules.ts:526-580 | Remover o bloco 526-580 de rules.ts (mantendo decideStripeEventClaim se quiser testá-lo, ou movendo a doutrina de duas fases para o comentário do webhook), atualizar o comentário de client.ts e limpar |
| P3 | ceo-launch | Registro de feature-flags com entradas Firebase mortas e descricao enganosa no auth.mfa | src/lib/feature-flags/index.ts:42,110-125 | Remover a area firebaseIntegration do registro e corrigir a descricao do auth.mfa para 'Requires Supabase Auth MFA (TOTP)'. Diff pequeno, zero impacto de runtime. |
| P3 | ceo-launch | vitest.config inclui glob de diretorio deletado (functions/) | vitest.config.ts:10 | Trocar o include por ['src/**/*.test.tsx'] (e se quiser destravar .test.ts puros no futuro, 'src/**/*.test.{ts,tsx}'). |
| P3 | dados | Six tables RLS-enabled-with-no-policy — mostly intentional deny-all; confirm subscriptions read gap | public.checkout_locks, course_title_keys, platform_config, processed_stripe_events, rate_limits, subscriptions | If direct client reads of own subscription are wanted, add `subscriptions_owner_sel` SELECT policy `user_id = auth.uid() OR is_admin()` (mirroring course_subscriptions_owner_sel). Otherwise leave as-i |
| P3 | dados | users_field_guard INSERT branch only blocks 'admin', allowing self-assignment of ops/support/moderator | supabase/migrations/ (nova migration) — funcao viva public.users_field_guard(), ramo BEFORE INSERT | Espelhar a regra do ramo UPDATE no ramo INSERT, numa migration versionada. Substituir o bloco INSERT por: `if tg_op = 'INSERT' then if exists (select 1 from jsonb_array_elements_text(new.roles) r wher |
| P3 | frontend-ux | Atalho 'Ctrl K' exibido na busca do sidebar é uma affordance morta | src/components/platform/platform-shell.tsx:193-208 | Registrar um listener de keydown no document (dentro de useEffect no PlatformSidebarSearch) que faz preventDefault e foca o input em Ctrl/Cmd+K; ou remover o chip 'Ctrl K'. Aproveitar e dar nome acess |
| P3 | frontend-ux | HorizontalTabs usa role=tab sem navegação por setas nem aria-controls | src/components/shared/horizontal-tabs.tsx:33-48 | Ou implementar o padrão completo (onKeyDown com ArrowLeft/ArrowRight + roving tabindex e aria-controls apontando para o painel), ou rebaixar a semântica para um grupo de botões com aria-pressed (como  |
| P3 | frontend-ux | Skeleton de loading do marketplace é silencioso para leitores de tela | src/components/courses/course-marketplace.tsx:385 | Adicionar um <p role="status" className="sr-only"> com 'Loading courses…' renderizado junto ao skeleton (mesmo padrão já usado no enrolled-course-workspace linha 316), removido quando isLoadingPublish |
| P3 | frontend-ux | Status de enrollment cru (enum técnico em inglês) interpolado em string traduzida no dashboard do aluno | src/components/learn/learn-dashboard.tsx:314-317 | Reusar o mesmo mapeamento do StatusChip (chaves statusChip.* já existentes nos 3 dicionários) para o valor interpolado: .replace("{status}", t(`statusChip.${enrollment.status}`)) com fallback para o v |
| P3 | frontend-ux | Tooltip da taxa Stripe no /pricing é inalcançável por teclado e leitor de tela | src/app/pricing/page.tsx:238-245 | Trocar o filho por um trigger focável: <button type="button" aria-label="What is the Stripe processing fee?" className="cursor-help"><HelpCircle aria-hidden .../></button> dentro do Tooltip (o compone |
| P3 | pagamentos | Matematica de fee duplicada em dois modulos (payment-split.ts vs rules.ts) com comentario 'SOURCE OF TRUTH' apontando para codigo Firebase removido | src/domain/payment-split.ts:23 | Deduplicar: rules.ts importa stripeProcessingFeeMinor/DEFAULT_PLATFORM_FEE_BPS de @/domain/payment-split (ou vice-versa, um unico dono), deletar a copia, e atualizar o comentario stale sobre functions |
| P3 | pagamentos | Refund parcial admin do MESMO valor dentro de 24h e silenciosamente replayed pela idempotency key — segundo refund nunca acontece | src/app/api/payments/refunds/admin/route.ts:117 | Incluir o estado pre-refund na key para diferenciar parciais sequenciais sem perder protecao contra double-submit real: `admin_refund_${orderId}_${amountMinor}_${alreadyRefundedMinor}`. Dois submits c |
| P3 | pagamentos | platformFeeBps de fallback trata '0' como falsy: professor Plus (0%) pode ser cobrado 8% em renovacao de assinatura | src/app/api/webhooks/stripe/route.ts:314 | Trocar por parse explicito: `const metaBps = Number(meta.platformFeeBps); const platformFeeBps = owner ? canonicalPlatformFeeBpsForPlan(owner.current_plan_id) : (Number.isFinite(metaBps) && metaBps >= |
| P3 | rotas-acesso | /api/csp-report: endpoint nao autenticado faz JSON.parse de corpo sem limite e sem rate limit | src/app/api/csp-report/route.ts:13 | Guard de uma linha antes do parse: const text = await request.text(); if (text.length > 16_384) return new NextResponse(null, { status: 204 }); — relatorios CSP reais tem centenas de bytes. |
| P3 | rotas-acesso | Comparacao do CRON_SECRET nao e constant-time | src/app/api/cron/release-payouts/route.ts:259 | const expected = Buffer.from(`Bearer ${cronSecret}`); const got = Buffer.from(authHeader ?? ""); if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return 401. |
| P3 | rotas-acesso | certificates/verify passa IP bruto como p_rate_key, inconsistente com o padrao hash-IP das rotas irmas | src/app/api/certificates/verify/route.ts:32-38 | Aplicar o mesmo padrao das irmas na propria rota: p_rate_key: `cert_${createHash("sha256").update(clientIp).digest("hex").slice(0, 24)}` — independe do que o RPC faca internamente. |
| P3 | rotas-acesso | vitest.config inclui glob morto functions/src/**/*.test.ts (residuo Firebase) | vitest.config.ts:10 | Remover "functions/src/**/*.test.ts" do array include. |

## Anexo — Precisa de verificacao humana (dashboard/DB)

| Sev | Dimensao | Achado | Fix |
|-----|----------|--------|-----|
| P1 | ceo-launch | Verificar Site URL + redirect allowlist do Supabase Auth — ativacao de professor exige email verificado | Checagem humana no dashboard Supabase (Authentication -> URL Configuration): (1) Site URL = https://www.skillsetmind.com; (2) Redirect URLs allowlist contendo https://www.skillsetmind.com/** e https:/ |
| P2 | ceo-launch | Price IDs dos planos (Starter/Pro/Plus) precisam de verificacao LIVE-mode antes do upsell de professor | Checagem humana no dashboard Stripe (modo LIVE, mesma conta da sk_live que ira para a Vercel): Product catalog -> confirmar que os 6 price_1TZFT... existem como Prices recorrentes USD (monthly/yearly  |
