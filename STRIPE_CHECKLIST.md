# STRIPE GO-LIVE CHECKLIST — campo por campo

> Gerado automaticamente na sessão autônoma de 2026-05-19.
> Tudo aqui depende de você (acesso ao painel Stripe / Firebase). O código já está pronto.
> Quando terminar cada item, marque `[x]`.

Projeto Firebase: **skillsetusaofficial** · Região functions: **us-central1**
Função de webhook: **stripeWebhook** · Modelo: **separate_charges_and_transfers**

---

## 1. Chaves de API (TEST primeiro, depois LIVE)

Onde: https://dashboard.stripe.com → canto superior direito, alterne **Test mode** ON para pegar as de teste; OFF para as LIVE.
Caminho: **Developers → API keys**.

| Campo no painel | O que copiar | Onde vai no nosso sistema |
|---|---|---|
| **Publishable key** (`pk_test_...` / `pk_live_...`) | a string inteira | `.env.local` → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=` (e no Vercel/Firebase env do front) |
| **Secret key** (`sk_test_...` / `sk_live_...`) | clique em **Reveal**, copie | Firebase secret `STRIPE_SECRET_KEY` (NÃO no .env do front, NÃO no git) |

Comando para gravar a secret key no Firebase (rodar você, no terminal do projeto):
```
firebase functions:secrets:set STRIPE_SECRET_KEY
# cole o sk_live_... quando pedir
```

## 2. Webhook endpoint

Onde: **Developers → Webhooks → + Add endpoint**.

| Campo | Valor exato a preencher |
|---|---|
| **Endpoint URL** | `https://us-central1-skillsetusaofficial.cloudfunctions.net/stripeWebhook` |
| **Description** | `Skillset marketplace — orders & payouts` |
| **Events to send** | selecione exatamente os 9 abaixo |

Eventos a assinar (clique **Select events** e marque só estes — é o que o código trata).

**Compra one-time + reembolso** (rail original):
- [ ] `checkout.session.completed`
- [ ] `checkout.session.expired`
- [ ] `payment_intent.payment_failed`
- [ ] `charge.refunded`

**Assinatura** (curso recorrente + plano SaaS do professor) — **obrigatórios p/ R1**:
- [ ] `invoice.paid` — fulfillment do ciclo: grava `payoutLedger` (held) + concede/reativa enrollment (`handleCourseSubscriptionInvoicePaid`, `index.ts:3199,3456`)
- [ ] `invoice.payment_failed` — período de graça (`past_due`, mantém acesso durante o dunning do Stripe) p/ curso; dunning do plano caso contrário (`handleInvoicePaymentFailed`, `index.ts:3195,4415`)
- [ ] `customer.subscription.created` — lifecycle (`handleCourseSubscriptionLifecycle` → fallback `syncSubscriptionFromStripe`, `index.ts:3168`)
- [ ] `customer.subscription.updated` — lifecycle: cancel/resume, `past_due`→`active` (revoga/restaura enrollment), `index.ts:3169`
- [ ] `customer.subscription.deleted` — lifecycle: revoga enrollment ativo→revogado, `index.ts:3186`

> ⚠️ **Sem os 5 eventos de assinatura, uma assinatura de curso COBRA o aluno mas NÃO concede/revoga acesso** (o webhook nunca dispara o fulfillment). Os mesmos 5 também alimentam o lifecycle do plano SaaS do professor.

Depois de criar o endpoint:
- Abra o endpoint criado → **Signing secret** → **Reveal** → copie o valor `whsec_...`
- Grave no Firebase:
```
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
# cole o whsec_... quando pedir
```

> ⚠️ A URL acima é o formato padrão Gen2/Firebase. Se o `firebase deploy` mostrar
> uma URL diferente (ex.: `https://stripewebhook-xxxxx-uc.a.run.app`), use a que o
> deploy imprimir e atualize o endpoint no Stripe. Está anotado em BLOCKERS.md.

## 3. Stripe Connect (pagamentos dos professores)

Onde: **Connect → Settings**.
- [ ] Connect ativado na conta (se aparecer "Get started", conclua o onboarding da plataforma)
- [ ] **Branding**: nome público "Skillset", logo, cor — aparece na tela de onboarding do professor
- [ ] **Payout settings**: confirme schedule padrão das contas conectadas (o hold de **30 dias** é nosso, no código `payoutReleaseDelayDays=30`; o payout interno da conta conectada é separado)
- [ ] Anote o **Connect client / platform** estar em modo LIVE quando for cutover

## 4. Test mode — validação antes do LIVE

- [ ] Com chaves TEST configuradas, rode o script: `node scripts/stripe-test-e2e.mjs` (ver TEST_RESULTS.md)
- [ ] Use cartão de teste `4242 4242 4242 4242`, qualquer data futura, qualquer CVC/CEP
- [ ] Confira no Stripe Dashboard (test) → Payments: cobrança de $100 aparece
- [ ] Confira Firestore: `orders` status `paid`, `payoutLedger` com `skillsetFeeMinor` + `stripeFeeMinor` + `netAmountMinor`

## 5. Cutover LIVE (só depois do item 4 verde)

- [ ] Repetir itens 1 e 2 com **Test mode OFF** (chaves `sk_live_` / `pk_live_` / webhook LIVE)
- [ ] `firebase deploy --only functions,hosting`
- [ ] Confirmar endpoint LIVE recebendo eventos (Stripe → Webhooks → ver "últimas entregas" 200)
- [ ] Primeira venda real de valor baixo como smoke test
- [ ] (NÃO automatizável por mim — está em BLOCKERS.md)

---

### Resumo do que o código espera de você
| Segredo | Onde configurar | De onde tirar |
|---|---|---|
| `STRIPE_SECRET_KEY` | Firebase secret | Stripe → Developers → API keys → Secret key |
| `STRIPE_WEBHOOK_SECRET` | Firebase secret | Stripe → Webhooks → seu endpoint → Signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `.env.local` + env do front | Stripe → Developers → API keys → Publishable key |
| `SKILLSET_APP_URL` (opcional) | env das functions | default já é https://skillsetusaofficial.web.app |
