# STRIPE GO-LIVE CHECKLIST — campo por campo

> Tudo aqui depende de você (acesso ao painel Stripe / Vercel). O código já está pronto.
> Quando terminar cada item, marque `[x]`.

Hospedagem: **Next.js na Vercel** · Dados: **Supabase (Postgres)**
Webhook: Route Handler `src/app/api/webhooks/stripe/route.ts` → `POST /api/webhooks/stripe`
Modelo: **direct charges** — a cobrança nasce na conta conectada do professor e a
comissão da plataforma sai como `application_fee_amount` (`src/app/api/payments/checkout/route.ts`).

Todas as variáveis de servidor abaixo vão em **Vercel → projeto → Settings → Environment
Variables** (Production, e Preview se for testar lá). Localmente, em `.env.local`.
Nunca no git, nunca com prefixo `NEXT_PUBLIC_`. Depois de mudar uma variável, faça um
redeploy para ela valer.

---

## 1. Chaves de API (TEST primeiro, depois LIVE)

Onde: https://dashboard.stripe.com → canto superior direito, alterne **Test mode** ON para pegar as de teste; OFF para as LIVE.
Caminho: **Developers → API keys**.

| Campo no painel | O que copiar | Onde vai no nosso sistema |
|---|---|---|
| **Publishable key** (`pk_test_...` / `pk_live_...`) | a string inteira | variável de ambiente do projeto na Vercel `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (e `.env.local` para dev) |
| **Secret key** (`sk_test_...` / `sk_live_...`) | clique em **Reveal**, copie | variável de ambiente do projeto na Vercel `STRIPE_SECRET_KEY` (NÃO no git, NÃO com `NEXT_PUBLIC_`) |

- [ ] Cole a secret key como **uma linha só**, sem espaço no meio: o código apara espaço/quebra de linha nas pontas, mas recusa uma chave com caractere inválido no meio (`sanitizeStripeSecret`, `src/lib/payments/rules.ts`).
- [ ] O modo da chave define o modo do webhook: com `sk_test_` o webhook ignora eventos LIVE (responde 503 para que o Stripe reentregue), e com `sk_live_` ignora eventos de teste.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` também precisa estar configurada: sem ela as rotas de dinheiro (checkout, webhook, reembolsos) respondem 503 `payments_not_configured` (`.env.example`).

## 2. Webhook endpoints

Onde: **Developers → Webhooks → + Add endpoint**.

Com direct charges, a venda de curso acontece na conta conectada do professor, então o
Stripe entrega esses eventos como eventos **Connect** — não chegam a um endpoint só de
plataforma. São **dois endpoints na mesma URL**, cada um com o seu signing secret; a rota
verifica a assinatura contra os dois.

| Endpoint | Campo "Listen to" | Endpoint URL | Signing secret vai em |
|---|---|---|---|
| Plataforma | Events on your account | `https://www.skillsetmind.com/api/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET` |
| Connect | Events on Connected accounts | `https://www.skillsetmind.com/api/webhooks/stripe` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

> ⚠️ Use o `www`: o domínio sem `www` responde 308 e o Stripe não segue redirect
> (`scripts/create-connect-webhook.mjs`).

Alternativa para o endpoint Connect: `node scripts/create-connect-webhook.mjs --secret-out <arquivo>`
(lê `STRIPE_SECRET_KEY` do `.env.local`, cria ou ajusta o endpoint com a lista abaixo e grava
o signing secret no arquivo, sem imprimi-lo; apague o arquivo depois). `--dry-run` só mostra o que faria.

Eventos a assinar — a lista exata de `HANDLED_STRIPE_EVENT_TYPES` na rota. Qualquer outro
evento é confirmado e ignorado.

**Compra one-time, reembolso e disputa:**
- [ ] `checkout.session.completed` — venda de curso: grava o pagamento, marca o pedido `paid`, libera o acesso e grava o registro de ganhos. Também confirma a taxa de ativação da vitrine (sessão com `purpose` de ativação).
- [ ] `checkout.session.async_payment_succeeded` — mesmo tratamento do anterior, para pagamento assíncrono.
- [ ] `checkout.session.async_payment_failed` — pedido `failed`.
- [ ] `checkout.session.expired` — pedido `cancelled`.
- [ ] `payment_intent.payment_failed` — pedido `failed`.
- [ ] `charge.refunded` — registra o reembolso.
- [ ] `charge.dispute.created` — registra a disputa.
- [ ] `charge.dispute.closed` — registra o resultado da disputa.

**Assinatura** (curso recorrente + plano do professor):
- [ ] `invoice.paid` — fulfillment do ciclo (`handleCourseSubscriptionInvoicePaid`).
- [ ] `invoice.payment_failed` — falha de cobrança do ciclo (`handleInvoicePaymentFailed`).
- [ ] `customer.subscription.created` — lifecycle (`handleCourseSubscriptionLifecycle` → fallback `syncSubscriptionFromStripe`).
- [ ] `customer.subscription.updated` — lifecycle, mesmo caminho.
- [ ] `customer.subscription.deleted` — lifecycle, mesmo caminho.

**Conta conectada:**
- [ ] `account.updated` — sincroniza se a conta do professor pode cobrar e receber (`handleConnectedAccountUpdated`).

> ⚠️ **Sem os eventos de assinatura, uma assinatura COBRA mas o acesso não é concedido nem
> revogado**, e o plano pago do professor não é aplicado — quem pagou continua no Free (`.env.example`).

Depois de criar cada endpoint:
- Abra o endpoint → **Signing secret** → **Reveal** → copie o `whsec_...`
- Grave na variável de ambiente do projeto na Vercel correspondente (tabela acima) e faça redeploy.

## 3. Stripe Connect (pagamentos dos professores)

Onde: **Connect → Settings**.
- [ ] Connect ativado na conta (se aparecer "Get started", conclua o onboarding da plataforma)
- [ ] **Branding**: nome público, logo, cor — aparece na tela de onboarding do professor
- [ ] **Payout settings**: o prazo e o calendário de payout são do Stripe, na conta conectada. A plataforma não segura dinheiro nem tem cron de liberação: o registro em `payout_ledger` é gravado já como `settled`, sem data de liberação (`src/app/api/webhooks/stripe/route.ts`).
- [ ] Confirme que Connect está em modo LIVE quando for o cutover

## 4. Test mode — validação antes do LIVE

- [ ] Com chaves TEST configuradas, rode `node scripts/stripe-test-e2e.mjs`. Ele imprime uma tabela de divisão de valores e, com `STRIPE_SECRET_KEY=sk_test_...`, cria uma Checkout Session de teste de $100 para provar a ligação com a API.
  - As fórmulas dessa tabela são uma cópia histórica e **não** acompanham o código atual — os valores reais estão em `src/lib/payments/rules.ts`.
  - A sessão criada pelo script não tem pedido associado. Não a pague contra um endpoint de teste que aponte para o app: a rota exige `orderId`/`courseId`/`userId` no metadata, lança erro e o Stripe fica reentregando o evento.
- [ ] Use cartão de teste `4242 4242 4242 4242`, qualquer data futura, qualquer CVC/CEP
- [ ] Faça uma compra de curso de verdade pelo app (em test mode) e confira no Supabase: tabela `orders` com status `paid`, e `payout_ledger` com `skillset_fee_minor`, `stripe_fee_minor` e `net_amount_minor`.
- [ ] Stripe Dashboard (test) → Webhooks → as entregas dos dois endpoints respondem 200.

## 5. Cutover LIVE (só depois do item 4 verde)

- [ ] Repetir itens 1 e 2 com **Test mode OFF** (chaves `sk_live_` / `pk_live_` / os dois webhooks LIVE)
- [ ] Atualizar as variáveis de ambiente do projeto na Vercel (Production) e fazer redeploy
- [ ] Confirmar os dois endpoints LIVE recebendo eventos (Stripe → Webhooks → últimas entregas com 200)
- [ ] Primeira venda real de valor baixo como smoke test

---

### Resumo do que o código espera de você
| Variável | Onde configurar | De onde tirar |
|---|---|---|
| `STRIPE_SECRET_KEY` | variável de ambiente do projeto na Vercel | Stripe → Developers → API keys → Secret key |
| `STRIPE_WEBHOOK_SECRET` | variável de ambiente do projeto na Vercel | Stripe → Webhooks → endpoint de plataforma → Signing secret |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | variável de ambiente do projeto na Vercel | Stripe → Webhooks → endpoint Connect → Signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | variável de ambiente do projeto na Vercel + `.env.local` | Stripe → Developers → API keys → Publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | variável de ambiente do projeto na Vercel | painel do Supabase (chave `service_role`) |
| `SKILLSET_APP_URL` (opcional) | variável de ambiente do projeto na Vercel | default é o `SITE_URL` canônico (https://www.skillsetmind.com) |
