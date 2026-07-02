# Plano de Prontidão de Lançamento — skillsetusa

> **Status:** EXECUÇÃO · **Data:** 2026-06-23 · **Branch:** `fix/payment-subscription-and-demo-cta`
> **Base:** auditoria de 16 dimensões, 42 agentes, verificação adversarial (workflow `w96kjeah9`).
> **Veredito:** **NÃO pronta para lançar.** 8 blockers confirmados + ~14 HIGH should-fix.
> **Restrição operacional:** Bash sequestrado pelo wrapper nesta sessão → gate/build/test/deploy/`npm install` bloqueados. Fixes de código puro são feitos agora; o resto fica empilhado para um único disparo (ver §Finish).

---

## 1. Veredito por dimensão

| # | Dimensão | Prontidão | Blocker? |
|---|----------|-----------|----------|
| 1 | Auth & conta | MINOR_GAPS | — |
| 2 | **Regras Firestore** | **BLOCKER** | ✅ paywall leak |
| 3 | Regras Storage | READY | — |
| 4 | Cloud Functions | READY | — |
| 5 | **Stripe checkout/assinaturas** | MAJOR_GAPS | ✅ (= paywall leak) |
| 6 | Stripe Connect/payouts | MINOR_GAPS | ✅ receita assinatura invisível |
| 7 | Jornada do aluno | MAJOR_GAPS | (vídeo blob = P0 perf, não-blocker) |
| 8 | Jornada do professor | MINOR_GAPS | — |
| 9 | Notificações & email | MAJOR_GAPS | — (email = HIGH) |
| 10 | Build & runtime | MINOR_GAPS | (CSP report-only = HIGH) |
| 11 | SEO | MAJOR_GAPS | — (HIGH) |
| 12 | **Legal & compliance** | MAJOR_GAPS | ✅ PostHog pré-consentimento (EU) |
| 13 | **Observabilidade & erros** | MAJOR_GAPS | ✅ sem error boundary · ✅ sem alerting |
| 14 | **Perf & a11y** | MINOR_GAPS | ✅ legendas WCAG 1.2.2 (A) |
| 15 | **Cobertura de testes** | MAJOR_GAPS | ✅ CI não roda rules tests |
| 16 | **Polish & stubs** | MINOR_GAPS | ✅ quiz vendável sem engine |

---

## 2. BLOCKERS confirmados (8)

| ID | Blocker | Evidência | Fix | Effort | Bash? |
|----|---------|-----------|-----|--------|-------|
| **B1** | Conteúdo pago de aula (`contentText`+`externalUrl`) world-readable via doc do curso publicado | `firestore.rules:1572` lê `courses/{id}` anon; função grava conteúdo no mesmo doc `functions/src/index.ts:541-542`; cliente mapeia tudo `published-courses.ts:182-194` | Mover `contentText`/`externalUrl` p/ subcoleção `courses/{id}/lessonContent/{lessonId}` gated por enrollment; doc público fica só com metadata + preview. Plano em `.claude/PAYWALL-LESSON-CONTENT-MIGRATION-PLAN.md` | L | deploy+rules+test |
| **B2** | Receita de cursos por assinatura **invisível** no wallet/sales do professor (vê $0 enquanto ledger paga) | checkout assinatura não grava `orders` (`index.ts:2243-2303`); wallet/sales leem só `orders` (`teacher-wallet-panel.tsx:192-219`, `sale-list.tsx:61-72`) | Dirigir headline + listas pelo `payoutLedger` (autoritativo p/ ambos os trilhos); incluir `kind:'course_subscription'` | M | não (código FE) |
| **B3** | PostHog (autocapture+session recording) dispara **antes do consentimento**, sem geo-gate → violação GDPR/ePrivacy p/ a audiência EU que o site declara | `posthog/client.ts:29` opt-out só se `==='rejected'` (null→captura ON); políticas servem EU (`privacy:181`) | Opt-in por padrão: `opt_out_capturing_by_default: getStoredCookieConsent() !== 'accepted'`; não ligar session_recording/autocapture até `accepted` | M (código S) | deploy |
| **B4** | Sem **error boundary** em todo o app → crash de render cai na tela bare do Next, sem recovery (paying user encalha no checkout/aula) | sem `error.tsx`/`global-error.tsx` (só `not-found.tsx`); zero `ErrorBoundary` | Criar `src/app/global-error.tsx` + `src/app/error.tsx` branded com reset()+links; chamar captureException | M | não |
| **B5** | Sem **alerting/uptime** num marketplace que move dinheiro → professor fica sem pagamento / comprador sem acesso, detectado só por reclamação | sem Sentry/Datadog; `firebase.json` sem alertPolicy; CI só lint/test/build; `index.ts:3238` incrementa `releaseAttemptCount` mas nunca lê (re-arma infinito) | Cloud Monitoring log-based metric + alertPolicy nos `logger.error` de payment/payout/webhook; uptime check no site + `stripeWebhook` | M | infra/gcloud |
| **B6** | **CI nunca roda os testes de regras** → regressão de rules entra verde | `.github/workflows/ci.yml:42` só `npx vitest run`; rules em `tests/*.ts` rodam só via `test:rules` (emulador), nunca invocado no CI | Job CI com `setup-java` + firebase-tools + `npm run test:rules`; tornar required | M | edição yaml (verificação precisa Bash) |
| **B7** | Vídeos de aula sem **legenda** (WCAG 1.2.2 nível A) e sem caminho de upload — e toggle "Auto-show captions" ligado que nunca funciona | `watermarked-video-player.tsx:38-44` `<video>` sem `<track>`; sem campo .vtt; toggle `account-settings-hub.tsx:332` | (a) player aceita `<track kind=captions>`; (b) upload .vtt + campo no domínio `CourseAsset`; interim: corrigir o toggle enganoso | L | não (código) |
| **B8** | Tipo de aula **"quiz" é vendável mas não tem engine** — aluno pagante bate em placeholder estático | selecionável `lesson-content-modal.tsx:68`, `course-builder-studio.tsx:252`; render estático `enrolled-course-workspace.tsx:771`; sem modelo/submissão/grading | **Launch-safe (A):** remover `quiz`/`assignment` dos pickers até existir engine. (B) construir engine = milestone próprio | S (opção A) | não |

---

## 3. HIGH should-fix (não bloqueiam, alto valor)

| ID | Item | Fix | Effort | Bash? |
|----|------|-----|--------|-------|
| H1 | Checkout pago não exige email verificado (fraude/chargeback) | assert `request.auth.token.email_verified` em `createCheckoutSession` + gate UI | S | deploy |
| H2 | Sem email de **recibo** de compra (`receipt_email` nunca setado) | `payment_intent_data.receipt_email = userEmail` (`index.ts:2433`) + runbook Stripe | S | deploy |
| H3 | **Refunds silenciosos** (sem email, sem notif in-app) | `writeNotification` ao comprador (e professor) em `handleChargeRefunded`/subscription | S | não (in-app) |
| H4 | Sem **infra de email transacional** | provider (Resend) atrás de `defineSecret`; priorizar recibo/refund/payout | L | install+deploy |
| H5 | **Installments** oferecido no builder mas ignorado no checkout | esconder toggle + copy "Supports installments" até implementar | S | não |
| H6 | Vídeo protegido baixa o **blob inteiro** antes de tocar (P0 perf/egress) | signed URL curto / proxy com Range; ver `improvement-triage.md` | L | deploy |
| H7 | Quiz/assignment placeholders contam p/ 100% e **certificado** | excluir do denominador de progresso / não-completáveis | M | não |
| H8 | **Inventário do marketplace invisível** em buscadores (creator courses + instructors client-side) | SSR de `/courses/[slug]` + `/instructors/[slug]` via Admin SDK + sitemap dinâmico + JSON-LD | L | não |
| H9 | Canonical errado em **todo** perfil de instrutor (`/instructors`) + título duplicado | trocar metadata estático por `generateMetadata({params})` com slug | S | não |
| H10 | `SITE_URL` hardcoded no `*.web.app` (SEO travado em subdomínio) | `NEXT_PUBLIC_SITE_URL` + domínio próprio | M | domínio |
| H11 | Sem withdraw/manage de **consentimento** após dismiss (GDPR 7(3); policy promete) | link "Cookie settings" no footer reabrindo o banner | S | não |
| H12 | Sem controle **CCPA "Do Not Sell/Share"** (postura US-first) | link "Your Privacy Choices" → `applyAnalyticsConsent(false)` + seção CPRA | M | não |
| H13 | Exceções de frontend **invisíveis** (sem captureException/handlers) | `enable_exception_autocapture` + `window.onerror`/`unhandledrejection` → captureException | S | não |
| H14 | CSP de produção **não-enforced** (full policy em Report-Only sem coletor) | promover Report-Only → `Content-Security-Policy` enforced (`firebase.json:54`) | M | deploy |
| H15 | Orquestração de `index.ts` (webhook/cron/refund) **sem testes** | `firebase-functions-test` + emulador p/ fluxos de dinheiro | L | install+CI |

**MEDIUM/LOW (polish):** auth (open-redirect sem teste; deletion sem record rastreável), payout cron 50/dia ceiling, sale-detail net antes-de-stripe-fee, SaleList "most recent 20" copy stale, certificate notification nunca produzida, money-collections rules sem teste, enrollment-update rule sem teste, metadataBase ausente, Organization/WebSite/BreadcrumbList JSON-LD ausente, OG dinâmico ausente, páginas públicas sem metadata, sitemap incompleto, sem code-splitting, hero LCP via CSS bg, ToS sem entidade/governing-law, Promise overclaim "one-click delete".

---

## 4. Ondas de execução

### Wave A — código puro, SEM Bash (executar AGORA)
- B8 quiz/assignment disable nos pickers
- B4 error boundaries (`global-error.tsx` + `error.tsx`)
- B3 PostHog opt-in default (parte de código)
- H13 captureException + global handlers
- H5 esconder installments toggle+copy
- H3 notificação in-app de refund (comprador+professor)
- certificate notification (LOW, dead type)
- H9 instructor `generateMetadata` (canonical+título por slug)
- metadataBase no layout
- H11 "Cookie settings" reabrir banner · H12 "Your Privacy Choices"
- SaleList copy + sale-detail net (`computePaymentSplit`)
- B2 wallet/sales orientados a `payoutLedger`
- B7 (interim) corrigir toggle "Auto-show captions" enganoso + player aceitar `<track>`
- H7 excluir quiz/assignment do denominador de progresso
- B6 escrever job CI `test:rules` · H14 promover CSP enforced (edição de arquivo)
- SEO polish (sitemap pages, JSON-LD Organization/WebSite/Breadcrumb, página metadata)

### Wave B — precisa Bash (gate/deploy/install) — empilhar
- B1 paywall split (rules + função + cliente + rules test) ← **prioridade máxima**
- H1 email_verified no checkout · H2 receipt_email
- H6 streaming de vídeo (signed URL/Range)
- H4 infra de email (Resend) · H15 testes de orquestração functions
- B7 (completo) sistema de upload de .vtt
- H8 SSR do inventário + sitemap dinâmico
- payout cron orderBy + paginação

### Wave C — infra/externo (guiar o dono)
- B5 Cloud Monitoring alertPolicy + uptime (gcloud)
- H10 domínio próprio + `NEXT_PUBLIC_SITE_URL`
- repo público → privado (task #19)
- runbook go-live Stripe (toggle "Successful payments")

---

## 5. Finish (quando o Bash voltar — disparo único)
```
npm run lint
npm run build
npm --prefix functions run build
npm test
npm run test:rules
# commit (respeitando lista de exclusão) + deploy
npm run deploy:full
```
**Lista de exclusão (nunca commitar):** `.claude/jarvis`, `.claude/logs`, `.claude/mission-control`, `.claude/sessions`, `logs/`, `docs/PROMPT-MELHORIA-CONTINUA.md`, `.claude/improvement-triage.md`, `.claude/launch.json`, `.claude/PAYWALL-LESSON-CONTENT-MIGRATION-PLAN.md`.

**Destravar Bash:** abrir sessão top-level nova (PowerShell → `cd` projeto → `claude`, NÃO `claude -c`), fora do wrapper Hermes/Codex. `echo hi` deve voltar `hi`.
