# Como ligar o Skillset — passo a passo (pra quem nunca mexeu)

> Você não precisa entender nada de técnico. É só **abrir os links**, **clicar** e **copiar/colar**.
> São 3 lugares: **Supabase**, **Stripe** e **Vercel**. Faça na ordem abaixo.
>
> ⚠️ O valor do `CRON_SECRET` está no **chat** (não guardo segredo em arquivo). Copia de lá quando chegar na hora.

---

## ⏱️ Ordem recomendada
1. Supabase (1 min — o mais fácil, começa aqui pra pegar confiança)
2. Stripe (pegar 2 valores: a "chave secreta" e o "segredo do webhook")
3. Vercel (colar 3 valores de uma vez)
4. Redeploy (pra ligar tudo)

---

## 🟢 PASSO 1 — Supabase: proteção de senha vazada → ⏸️ ADIADO (é plano Pro)

**Status:** essa opção **só existe no plano Pro** do Supabase. No plano grátis (Free) ela aparece bloqueada. **Não é bloqueador de lançamento** — pode pular.

**O que é:** rejeita senhas que já vazaram em vazamentos famosos. O básico (tamanho mínimo de senha) o Supabase já garante de graça.

**Quando fazer:** quando você for pro plano **Pro** do Supabase (o motivo real pra ir Pro num site de dinheiro é o **backup diário automático** — não essa opção). Aí:
1. Abre: 👉 https://supabase.com/dashboard/project/ijtikldtjvsbtwszokvs/auth/providers
2. Clica no provider **Email** → no modal, acha **"Prevent use of leaked passwords"** → liga → **Save**.

✅ Passo 1: **adiado de propósito** (sem custo de segurança relevante agora).

---

## 🔵 PASSO 2 — Stripe: pegar as 2 chaves de verdade (LIVE)

> ⚠️ **O MAIS IMPORTANTE:** no canto superior direito do Stripe tem um botão **"Test mode"**.
> Ele tem que estar **DESLIGADO** (modo real / Live). Se estiver ligado (laranja), você pega chaves de teste que **não recebem dinheiro de verdade**.

### 2a) Copiar a Chave Secreta (Secret key)
1. Abre: 👉 https://dashboard.stripe.com/apikeys
2. Confirma que está em **modo real** (Test mode DESLIGADO).
3. Na linha **"Secret key"**, clica em **"Reveal live key"** e **copia** o valor.
   - Ele começa com **`sk_live_...`**
4. **Guarda esse valor** (cola num bloco de notas por enquanto). Vai usar no Passo 3.

### 2b) Criar o Webhook (o "aviso" que o Stripe manda quando alguém paga)
1. Abre: 👉 https://dashboard.stripe.com/webhooks
2. Confirma de novo: **modo real** (Test mode DESLIGADO).
3. Clica em **"Add endpoint"** (Adicionar endpoint).
4. No campo **Endpoint URL**, cola exatamente:
   ```
   https://skillsetmind.com/api/webhooks/stripe
   ```
5. Em **"Select events"** (selecionar eventos), adiciona **exatamente estes 11** (pode buscar um por um):
   ```
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   checkout.session.expired
   payment_intent.payment_failed
   charge.refunded
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   invoice.payment_failed
   invoice.paid
   ```
6. Clica em **"Add endpoint"** pra salvar.
7. Agora abre o endpoint que você acabou de criar. Vai ter um **"Signing secret"** (segredo de assinatura).
   Clica em **"Reveal"** e **copia** o valor.
   - Ele começa com **`whsec_...`**
8. **Guarda esse valor** também. Vai usar no Passo 3.

✅ Feito o passo 2. Você tem 2 valores anotados: um `sk_live_...` e um `whsec_...`.

---

## 🟣 PASSO 3 — Vercel: colar as 3 variáveis (de uma vez só)

**O que é:** onde o site "guarda" as chaves com segurança. Vamos colar 3.

1. Abre: 👉 https://vercel.com/patrick-simons-projects/skillset-foundation/settings/environment-variables
2. Você vai adicionar **3 variáveis**. Pra cada uma: escreve o **Nome (Key)**, cola o **Valor (Value)**, deixa marcado **"Production"**, e clica **"Save"**.

| # | Nome (Key) | Valor (Value) |
|---|------------|---------------|
| 1 | `STRIPE_SECRET_KEY` | o `sk_live_...` que você copiou no passo 2a |
| 2 | `STRIPE_WEBHOOK_SECRET` | o `whsec_...` que você copiou no passo 2b |
| 3 | `CRON_SECRET` | **o valor que o Claude te passou no chat** |

> Dica: no campo "Environments", deixa só **Production** marcado (ou os 3, tanto faz — o que importa é Production estar marcado).

✅ Feito o passo 3.

---

## 🔁 PASSO 4 — Redeploy (ligar tudo)

As variáveis só valem depois de um novo deploy.

**Opção fácil:** me avisa no chat que **eu re-deployo pra você** (1 clique meu).

**Ou você mesmo:**
1. Abre: 👉 https://vercel.com/patrick-simons-projects/skillset-foundation/deployments
2. No deploy do topo (o mais recente), clica no menu **"..."** → **"Redeploy"** → confirma **"Redeploy"**.
3. Espera ficar **"Ready"** (uns 60 segundos).

✅ Pronto. Agora o site recebe pagamento de verdade e paga o professor sozinho depois de 30 dias.

---

## 🧪 Depois de tudo: teste de R$/$ 1
Quando terminar, me chama que a gente faz **uma compra-teste** de verdade (valor baixo) pra confirmar que:
- o pagamento entra,
- o webhook registra,
- e o repasse fica agendado certinho.

---

## ❓ Se algo der errado
- **"Test mode" ligado sem querer** → você pegou `sk_test_`/`whsec_` de teste. Volta, desliga Test mode, e pega os `sk_live_`/`whsec_` de novo.
- **Webhook aparece com erro no Stripe** → confirma que a URL é exatamente `https://skillsetmind.com/api/webhooks/stripe` e que o `STRIPE_WEBHOOK_SECRET` no Vercel é o mesmo daquele endpoint.
- **Qualquer dúvida** → manda print no chat, eu te falo o que clicar.
