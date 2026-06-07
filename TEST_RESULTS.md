# TEST RESULTS — pagamento marketplace

> Sessão autônoma 2026-05-19. Validação determinística do split financeiro.
> Script: `node scripts/stripe-test-e2e.mjs`

## 1. MATH mode — VERIFICADO ✅ (rodado nesta sessão)

Espelha as fórmulas exatas de `functions/src/index.ts`:

```
scenario               |     gross | platform8% |  stripeFee |   teacherNet |  platformNet
--------------------------------------------------------------------------------------------
$10 course (USD)       |    $10.00 |       $0.80 |      $0.59 |        $8.61 |        $0.80
$50 course (USD)       |    $50.00 |       $4.00 |      $1.75 |       $44.25 |        $4.00
$100 course (USD)      |   $100.00 |       $8.00 |      $3.20 |       $88.80 |        $8.00
$200 course (USD)      |   $200.00 |      $16.00 |      $6.10 |      $177.90 |       $16.00
$100 course (intl)     |   $100.00 |       $8.00 |      $5.70 |       $86.30 |        $8.00
```

**Confirmado:**
- Professor absorve a taxa Stripe; `teacherNet = gross - planFee - stripeFee`.
- Plataforma mantém a comissão do plano cheia (`platformNet` = comissão integral).
- USD = 2.9%+$0.30; non-USD estimado = 5.4%+$0.30.
- Caso $100 USD no plano Free: aluno paga $100 -> professor recebe **$88.80** após **D+30** -> plataforma **$8.00**. _(payout = 30 dias, decisão final 2026-06-06; ver DECISIONS D21. O split em si independe do prazo.)_

## 2. Caso feliz manual (a fazer quando tiver chave TEST — BLOCKERS B1)

Pré-requisitos: `STRIPE_SECRET_KEY=sk_test_...` como secret do Firebase, professor com Stripe Connect (test) concluído, 1 curso publicado a $100.

Passos:
1. `STRIPE_SECRET_KEY=sk_test_xxx node scripts/stripe-test-e2e.mjs` → cria Checkout Session TEST real, imprime URL.
2. Abrir URL, pagar com `4242 4242 4242 4242`, validade futura, CVC qualquer.
3. Stripe webhook dispara `checkout.session.completed` → `stripeWebhook`.

**Output esperado no Firestore:**
| Coleção | Doc | Campos-chave esperados |
|---|---|---|
| `orders` | o id do pedido | `status: "paid"`, `paymentIntentId` preenchido, `payoutModel: "separate_charges_and_transfers"` |
| `payments` | paymentIntentId | `status: "succeeded"`, `amountMinor: 10000` |
| `payoutLedger` | auto id | `grossAmountMinor: 10000`, `skillsetFeeMinor: 800`, `stripeFeeMinor: 320`, `netAmountMinor: 8880`, `status: "in_release"`, `releaseAt ≈ now + 10d` |
| `enrollments` | `{uid}__{courseId}` | `status: "active"` |

**Output esperado no Stripe Dashboard (test):**
- Payments: 1 pagamento de $100 capturado.
- Após `releaseAt` (7 dias) e job de release: 1 Transfer de **$81.80** para a conta conectada do professor.
- Webhook deliveries: `checkout.session.completed` com resposta **200**.

## 3. Bloqueio
LIVE-TEST mode não rodou nesta sessão: sem `sk_test_` no ambiente (esperado — ver BLOCKERS.md **B1**). Código e script prontos; falta só a chave.
