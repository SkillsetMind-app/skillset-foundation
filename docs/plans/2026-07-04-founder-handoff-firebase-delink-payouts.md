# Handoff do Founder — De-link Firebase + Sistema de Repasse + Hardening

**Data:** 2026-07-04 (madrugada, sessão autônoma)
**Branch:** `feat/design-v2` (nível com `origin/main`)
**Escopo entregue nesta sessão:** desvincular 100% do Firebase · motor de repasse ao professor (modelo Hotmart/Kiwify D+) · clawback de reembolso · hardening de segurança (RLS, headers HTTP) · substituição Supabase-native do "Trending".

> **Regra de ouro deste doc:** o código novo de pagamento/cron está **dormente por padrão** — só liga quando os secrets abaixo forem setados. Ou seja, dá pra fazer deploy a qualquer hora sem risco; nada dispara cobrança/repasse até você ligar.

---

## 🔴 AÇÕES CRÍTICAS (fazer antes de operar dinheiro de verdade)

### 1. Rotacionar a `service_role` do Supabase (VAZOU em 02/07)
- Supabase → **Project Settings → API → Service role → Reset/Rotate**.
- Copiar a nova chave e atualizar **`SUPABASE_SERVICE_ROLE_KEY`** no Vercel (Production).
- Motivo: a chave antiga apareceu em transcript. Ela **bypassa toda RLS** = acesso root ao banco. Enquanto não rotacionar, considere o banco comprometido.

### 2. Ligar proteção de senha vazada (Supabase Auth) — ⏸️ ADIADO: só no plano Pro
- Verificado 2026-07-04: o projeto está no plano **Free**. O toggle **"Prevent use of leaked passwords"** (Authentication → Sign In / Providers → Email) é **Pro-only** — aparece bloqueado no Free.
- **NÃO é bloqueador de launch.** É o item de menor prioridade (o min-password-length já roda no Free). Ligar quando/se subir pro Supabase Pro (o motivo real de ir Pro num site de dinheiro é o **backup diário automático**, não este toggle).

### 3. Secrets do Stripe (LIVE) no Vercel
Sem eles o checkout/webhook ficam dormentes (retornam 503/erro de assinatura):
- **`STRIPE_SECRET_KEY`** = `sk_live_...` (liga o cliente Stripe).
- **`STRIPE_WEBHOOK_SECRET`** = `whsec_...` (verificação de assinatura do webhook).
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` já está setada (`pk_live_...`).

### 4. Endpoint de webhook LIVE no Stripe
- Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
- URL: **`https://skillsetmind.com/api/webhooks/stripe`**
- Assinar EXATAMENTE estes eventos (o handler só processa estes):
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
  - `payment_intent.payment_failed`
  - `charge.refunded`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `invoice.paid`
- Copiar o **Signing secret** → `STRIPE_WEBHOOK_SECRET` (item 3).

### 5. `CRON_SECRET` — liga o motor de repasse
- Gerar um segredo forte (ex.: `openssl rand -hex 32`).
- Vercel → Environment Variables → **`CRON_SECRET`** = esse valor (Production).
- O Vercel Cron manda `Authorization: Bearer <CRON_SECRET>` automaticamente. Sem essa var, a rota `/api/cron/release-payouts` responde **401** e nada é liberado (dormente por design).

---

## 💸 Como o repasse funciona (pra você saber, não pra mexer)

Modelo **separate charges & transfers + hold de 30 dias** (igual Hotmart/Kiwify D+):
1. Aluno paga → webhook grava uma linha em `payout_ledger` com status `in_release` e `release_at = agora + 30 dias`.
2. O cron diário (`vercel.json` → `/api/cron/release-payouts`, 03:00 UTC) pega as linhas vencidas e faz `stripe.transfers.create` pra conta Connect do professor.
3. Se o aluno pede reembolso dentro da janela, o webhook reverte o repasse (`transfers.createReversal`) — inclusive se já tiver sido liberado (clawback).
- **Por que 30 dias:** passa folgado da janela de reembolso (7 dias), então você quase nunca precisa perseguir dinheiro já repassado. É o padrão de mercado, não gambiarra.
- **Pré-requisito:** o professor precisa ter concluído o onboarding do **Stripe Connect Express** (KYC). Sem conta conectada, o ledger re-arma e tenta de novo depois (não perde o dinheiro).

---

## 🟡 AÇÕES RECOMENDADAS (não bloqueiam operar, mas faça logo)

### 6. Deploy pra produção — ✅ JÁ FEITO
- Já **pushei** pra `main` (commit `28e99af`) e o Vercel já **promoveu pra produção**: deploy `READY`, no ar em `skillsetmind.com` / `www.skillsetmind.com`.
- Seguro por design: o código de repasse/cron continua **dormente** até você setar os secrets acima (§3–§5). Ou seja, publicou tudo, mas nada dispara dinheiro ainda.
- Nada a fazer aqui — só está registrado pra você saber que o site vivo já é esta versão.

### 7. Snapshot das migrations no repo
- Apliquei migrations direto no banco (via MCP) — elas estão registradas no Supabase, mas não como arquivos no repo (exceto `bunny_video_id`).
- Pra versionar tudo: `supabase db pull` (gera os arquivos em `supabase/migrations/`).

### 8. CSP (Content-Security-Policy)
- Adicionei os headers de segurança seguros (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) em `next.config.ts`.
- **Não** adicionei CSP — ela precisa ser testada ao vivo contra Stripe.js, PostHog, Supabase, Google OAuth e os iframes Bunny/YouTube/Vimeo, senão quebra o site. Rodar depois em modo `report-only` primeiro.

### 9. Repo → privado
- Se o repositório ainda está público, torná-lo privado (histórico de chaves/config).

---

## 🎬 Bunny Stream (gates que já existiam, do trabalho de vídeo 07-04)
- Aplicar a migration `bunny_video_id` (se ainda não aplicada — o MCP Supabase daqui não tinha access-token).
- Setar 3 envs Bunny no Vercel (library ID + chaves — ver cofre).
- **Ligar Token Authentication** na library Bunny `696805`.
- Sem `NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID`, todo upload de vídeo cai no Supabase Storage antigo (zero regressão). O embed YouTube/Vimeo funciona independente disso.

---

## ✅ O que EU já fiz nesta sessão (não precisa refazer)

- **Firebase 100% removido:** `.firebaserc`, `firebase.json`, `*.rules`, `functions/` inteiro, deps, envs `NEXT_PUBLIC_FIREBASE_*`, host `firebasestorage` no `next.config`, domínio morto `skillsetusaofficial.web.app` → `skillsetmind.com`.
- **Trending virou Supabase-native:** a função agendada do Firebase (`course-trending.ts`) foi substituída por `pg_cron` (job `recompute-course-trending`, diário 03:10 UTC) + função `recompute_course_trending_scores()`. Já rodou o backfill (0 cursos com atividade agora — normal, pré-lançamento). O sort "Trending now" degrada pra A→Z quando não há atividade (sem crash).
- **`course-analytics.ts` (Firebase):** removida sem órfãos — não havia campo de UI dependente (os eventos server-side já tinham sido dropados na migração de pagamentos; PostHog client-side continua ativo).
- **Motor de repasse + clawback:** `/api/cron/release-payouts` + `vercel.json` cron + reversão no webhook.
- **Hardening DB:** RLS revisada; `REVOKE EXECUTE` cirúrgico em funções internas/trigger e `anon` nas RPCs authenticated-only (mantendo `verify_skillset_certificate` público, `enforce_rate_limit`/`is_admin` e os predicados de RLS intactos).
- **Hardening HTTP:** headers de segurança no `next.config.ts`.
- **Node:** `.nvmrc` → 24.
- **Auditoria vibecoding (2026):** checado contra as 8 classes mais comuns — secrets no bundle (limpo), RLS (ok), assinatura Stripe (ok), subscription spoofing (server-side), SSRF/embed (o `lesson-embed.ts` reconstrói a URL de um template fixo = à prova de injeção), endpoints sem auth (cron com Bearer). Único gap real de código = headers (corrigido).

---

## 📌 Pendências de conteúdo/legal (suas)
- Trocar os `[DEFINE:]` nos textos legais (fatos que só você pode confirmar).
- Templates de e-mail transacional com marca (se ainda faltam).
- Compra-teste de $1 end-to-end depois de ligar os secrets, pra validar o fluxo completo.
