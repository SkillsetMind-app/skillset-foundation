# Stripe Connect — Status, Custos e Go-Live Runbook

Atualizado: 2026-05-11 (verificado via Stripe API, read-only)

## Status verificado da conta LIVE

Conta: `acct_… (conta da plataforma)` — "SKILLSET USA" (US, USD)

- `charges_enabled`: true
- `payouts_enabled`: true
- `details_submitted`: true
- `transfers` capability: **active** (essencial para Connect — plataforma pode transferir para contas de teachers)
- `card_payments`: active · `pix_payments`: active (bom para Brasil) · `link_payments`: active
- **Connect: JÁ HABILITADO** (listagem de connected accounts funciona; 0 contas conectadas ainda, esperado)
- **Webhook LIVE: JÁ CONFIGURADO** em `https://stripewebhook-7foyhb2owa-uc.a.run.app`, status `enabled`, eventos: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`

Conclusão: **não falta nada no Stripe Dashboard.** O Connect está pronto. O que falta é o cutover de credenciais TEST→LIVE no código, que deve acontecer SÓ após QA de browser.

## Resposta à pergunta de custo

**Habilitar/usar Stripe Connect é GRÁTIS.** Não há taxa de setup nem mensalidade de plataforma. Custos só existem quando há venda real:

| Item | Custo | Quando incide |
|---|---|---|
| Habilitar Connect | $0 | nunca cobra |
| Processamento de cartão (US) | ~2.9% + $0.30 por cobrança | por venda paga |
| Cartão internacional / câmbio | +~1.5% (intl) +~1% (conversão) | venda com cartão estrangeiro |
| Conta Express ativa | $2/mês por conta **que recebeu payout naquele mês** | só meses com payout do teacher |
| Payout para teacher (Express) | 0.25% + $0.25 por payout | por payout executado |
| Taxa de plataforma Skillset (8/4/1/0% por plano) | **receita da Skillset**, não custo | por venda |

Sem tráfego = custo zero. Com vendas, o custo é proporcional e a taxa do plano Skillset cobre processamento e margem conforme o tier.

## Estado atual do código (consistente e seguro)

- Frontend `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: **TEST** (`pk_test_...`)
- Functions `STRIPE_SECRET_KEY`: **TEST** (`sk_test_...`, versão 2 ENABLED)
- Functions `STRIPE_WEBHOOK_SECRET`: presente (`whsec_`, 38 chars — secret do webhook de TESTE)
- `NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED`: true

Tudo consistente em TEST. **Correto para a fase atual** (produto sem QA de browser). Não flipar para LIVE antes do QA — dinheiro real em fluxo não testado é risco crítico.

## Go-Live Runbook (executar SÓ quando QA de browser passar)

As chaves LIVE estão no vault local (arquivo de APIs do founder), conta "SKILLSET USA / AUOPS Courses". Cutover em 5 passos:

1. Obter o `whsec_` LIVE do webhook existente:
   - Stripe Dashboard → Developers → Webhooks → endpoint `https://stripewebhook-7foyhb2owa-uc.a.run.app` → "Signing secret" → Reveal. (Stripe não expõe o secret de webhook já criado via API; só no Dashboard ou recriando o endpoint.)

2. Setar secrets LIVE nas Functions (NUNCA em arquivo fonte):
   ```bash
   firebase functions:secrets:set STRIPE_SECRET_KEY --project skillsetusaofficial
   # colar o sk_live_... quando solicitado
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project skillsetusaofficial
   # colar o whsec_ LIVE do passo 1
   ```

3. Atualizar `.env.local` (frontend) para a publishable LIVE:
   ```
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
   ```

4. Redeploy:
   ```bash
   firebase deploy --only functions --project skillsetusaofficial
   npm run build && firebase deploy --only hosting --project skillsetusaofficial
   ```

5. Smoke test LIVE com cartão real de baixo valor ($1):
   - Compra completa → webhook → enrollment criado (sem duplicar em reentrega de webhook).
   - Reembolso → order/payment/enrollment atualizam.
   - Connect: teacher conecta conta Express → `createTeacherStripeAccountLink` → onboarding → volta com `charges_enabled`/`payouts_enabled`.

## Guardrails de go-live

- Objetos de TEST não migram para LIVE; webhook LIVE já existe (ok).
- Nunca conceder acesso a curso a partir de `success_url` — só via webhook verificado (código já faz isso).
- Verificar idempotência: webhook duplicado não cria enrollment duplicado (já há `idempotencyKey` no checkout; confirmar no webhook handler).
- Rotacionar qualquer chave que tenha sido colada em lugar inseguro.
- Manter `sk_live_` apenas em Firebase Secret Manager, jamais em `NEXT_PUBLIC_*` ou fonte.

## Onda 5-B — Ativação do checkout de curso no catálogo (2026-05-30)

O que mudou no código nesta onda:

- **CTA de curso pago agora liga de fato.** `course-enrollment-cta.tsx` (páginas
  de curso *showcase* estáticas — home featured / links diretos) tinha um botão
  desabilitado no modo `paid_checkout_required`. Agora, com o flag de checkout
  ligado, o botão chama `startCourseCheckout(course.id)` com spinner + erro
  gracioso (espelha `creator-course-detail.tsx`). Se o curso não resolver no
  backend, o servidor devolve mensagem honesta ("Course not found." / "teacher
  has not connected Stripe payouts yet.") em vez de travar.

Fato físico do fundador que isto expõe (precisa da sua máquina/credencial):

- **O catálogo `/courses` (marketplace) só lista cursos publicados REAIS do
  Firestore** (`subscribeToPublishedTeacherCourses` → `where status == published`).
  Os 6 cursos demo estáticos (`src/data/demo/courses.ts`) NÃO são docs Firestore
  e NÃO têm teacher com Stripe Connect — então clicar "comprar" num *showcase*
  demo pago (`mental-health-foundations`, `effective-communication`) cai no erro
  gracioso, não numa compra.
- **Caminho de pagamento ao vivo para o demo (recomendado):** publicar UM curso
  real pelo Teacher Studio com a conta de teacher conectada ao Stripe Connect.
  Ele aparece automaticamente em `/courses` → investidor clica → `CreatorCourseDetail`
  (já fiado, `startCourseCheckout`) → Stripe Checkout LIVE → webhook → enrollment
  → `/learn`. Este é o fluxo autêntico do marketplace e exercita o loop
  create→publish→buy que a Onda 3 endureceu.
- **Alternativa (semear demos):** se quiser que os 2 *showcase* demos pagos também
  sejam compráveis, criar docs Firestore `courses/{course-mental-health-foundations}`
  e `courses/{course-effective-communication}` com shape `TeacherCourseRecord`
  (`status: published`, `ownerId` = uid do teacher conectado). Opcional — o curso
  real do Teacher Studio já cobre o momento de pagamento do demo.

Pré-condições para o checkout ligar (todas físicas/do fundador):

1. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...` no ambiente de produção.
2. `NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED=true` (default do flag é `false`;
   `getPublicFeatureFlagOverrides` só liga se a env var for exatamente `"true"`).
3. Teacher conectado ao Stripe Connect (`charges_enabled` + `payouts_enabled`).
4. $1 LIVE smoke (passo 5 do runbook acima).

> A mesma `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` também liga o checkout de
> **assinatura** (`/account/billing/upgrade?plan=<id>` → `EmbeddedCheckoutPanel`).
> Sem a key, esse painel mostra banner honesto "Checkout is being set up." —
> não trava.

### Deferido para Onda 6 (não fiz — risco no caminho crítico de auth)

- **Threading do `plan` da pricing → signup → onboarding → billing/upgrade.** A
  página `/account/billing/upgrade` JÁ consome `?plan=` e funciona. O que falta é
  carregar o `plan` escolhido na `/pricing` através da máquina de estados de auth
  (`src/lib/auth/routing.ts` — `getLoadingRoute`/`getPostAuthRoute`/`getAuthPathQuery`
  só threadam `path`/`role`, sem passthrough genérico; + `auth-page`, `/loading`,
  `welcome-choice.tsx`, `onboarding-choice.tsx`). Não é dead-end hoje: signup
  funciona, teacher cai em `/teach`, e o upgrade é alcançável manualmente por
  Account → Billing. Threading é continuidade (polish), não gap, e toca o caminho
  de conversão mais crítico — deixado para depois do QA de browser.
