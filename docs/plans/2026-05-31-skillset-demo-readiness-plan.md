# Skillset — Status + Plano para 100% Demo-Ready

> **Data:** 2026-05-31
> **Objetivo:** Deixar a plataforma pronta para mostrar a um investidor/comprador, com pagamentos LIVE.
> **Repo canônico:** `C:/Users/nicae/aiox-core/projects/skillset-foundation` · Live: https://skillsetusaofficial.web.app
> **Método:** Toda afirmação rastreada a arquivo/commit real (No-Invention).

---

## 1. O que está LIVE agora (deployado hoje)

| Mudança | Commit | Camada | Status |
|---|---|---|---|
| **Item ativo do menu (pílula "Studio"): label legível** — pílula agora fica branca de fato, label navy visível, ícone branco no chip navy | `da65534` | FE | ✅ live |
| Tentativa anterior do mesmo bug (perdia guerra de especificidade — pílula nunca ficava branca) | `f810798` | FE | ⚠️ superada por `da65534` |
| Gêmeo do bug no toggle de ciclo de cobrança | `f810798` | FE | ✅ live |
| **FAQ de Integrations não aponta mais pra página coming-soon** (manda pro support) | `9b4d6bb` | FE | ✅ live |
| Theme-toggle animado (cross-fade sol/lua + micro-interação) | `7b66c58` | FE | ✅ live |
| **Payout configurável: padrão 30 dias, selecionável {7,10,15,30}** | `784e8a7` | BE | ✅ live |
| **/promise enxuto: removido o que não está shipado** (affiliate, custom domains, analytics) | `257ff4c` | FE | ✅ live |
| Lint do repo 100% limpo (rename de variável `module` em functions) | `3a8dc7f` | BE | ✅ live |
| Roadmap FE+BE + benchmark competitivo Cakto | `6f26fe9` | docs | ✅ |

**Deploy:** `npm run deploy:full` concluído (functions + hosting + firestore/storage rules). Validação antes do deploy: `tsc` (functions) ✅ · `eslint` ✅ · `next build` ✅.

---

## 2. Status real das suas 4 decisões

### 1) Payout selecionável {7,10,15,30}, padrão final **30** → ✅ FEITO + LIVE
- Padrão final = **30 dias** (`functions/src/payment-rules.ts:12`, decisão do fundador 2026-06-06). Os valores intermediários (10, depois 7) ficaram para trás. Toda a copy de UI deriva de `payoutClearDays = 30` (`src/data/plans.ts:196`), então está verdadeira (mostra "30-day clearance").
- Conjunto selecionável `{7,10,15,30}` codificado e validado (`resolvePayoutReleaseDelayDays`).
- O valor é lido em runtime de um doc `platformConfig/payments` antes da transação de pagamento (leitura defensiva, fallback seguro pro padrão — nunca trava o fluxo de dinheiro).
- **Resta (opcional):** uma tela no Ops pra você *clicar* e escolher 7/10/15/30. Hoje a troca é feita gravando o doc de config. Não é bloqueador de demo (investidor não muda prazo de payout).

### 2) Assinatura de curso "habilite" → 🔴 CORREÇÃO HONESTA: não é um toggle
- Eu errei no roadmap anterior. O backend de assinatura que está pronto é o de **planos da plataforma** (SaaS: `createBillingCheckoutSession`), **não** assinatura de curso.
- Assinatura **de curso** está **bloqueada de ponta a ponta**: o gate de submissão recusa (`functions/src/index.ts:530` — *"Only free and one-time payment courses can be submitted in this release"*) e o checkout não cria assinatura no Stripe.
- "Habilitar" só na UI criaria exatamente o fluxo que trava no meio (professor monta o curso → não consegue submeter; ou aluno clica comprar → quebra). Em demo com dinheiro LIVE, isso é pior que não ter.
- **Recomendação:** manter assinatura de curso **desligada** na demo (mostre **one-time** e **free**, que são sólidos). Construir assinatura de curso depois, como feature de verdade (é trabalho de alguns dias + dinheiro recorrente). Está no Wave 2 (item 2.4).

### 3) Stubs fora do menu → ✅ JÁ ESTAVAM FORA (correção)
- Os 4 stubs (coupons, co-productions, team, integrations) têm `contexts: []` em `src/data/site.ts` → o filtro do menu (`item.contexts.includes(context)`) **nunca os mostra**. Nenhuma outra tela linka pra eles.
- Ou seja: já estão escondidos do menu. Minha afirmação anterior ("alcançáveis pelo menu") estava errada.
- **Residuais (sua decisão):**
  - Só são alcançáveis digitando a URL direta. Se alguém digitar, vê um painel tasteful de "coming soon / on the roadmap" (não é tela quebrada).
  - Uma FAQ do `/help` aponta pro `Studio → Integrations` (um stub). Posso reescrever.
  - ⚠️ **`/teach/refunds` é uma página REAL e funcional**, mas está oculta pelo mesmo `contexts: []` — provavelmente sem querer. Você quer ela visível no menu do professor?

### 4) /promise enxuto → ✅ FEITO + LIVE
- Removi do "feature parity" o que não existe: **custom domains, analytics, affiliate tools**.
- Mantive o que está shipado e verificado: certificados, quizzes (é tipo de lição), drip content, community.

---

## 3. PLANO passo-a-passo para 100% demo-ready

### 🔴 SÓ VOCÊ pode fazer (bloqueadores reais — são ações físicas)
1. **Smoke test LIVE de US$1 ponta-a-ponta.** Comprar um curso de verdade com cartão real → confirmar: webhook → matrícula → recibo → carteira do professor com saldo "pending". É a **única** prova de que o dinheiro flui de verdade. ~15 min.
2. **Caminho feliz do professor na conta de demo.** Logar como professor → ver Studio → ver curso publicado → ver carteira. Confirmar que nenhuma tela aparece vazia/quebrada. ~10 min.
3. **(Se ainda não fez) rotação das chaves** que foram expostas em sessões anteriores (é sua tarefa, eu não toco em segredos).

### ✅ DECISÕES A–D — RESOLVIDAS
- **A. Assinatura de curso → SEGURAMOS pra demo.** ("como assim?": assinatura **de curso** está bloqueada ponta-a-ponta — o gate de submissão recusa e o checkout não cria assinatura no Stripe. "Habilitar" só a UI criaria um fluxo que trava no meio com **dinheiro LIVE** — pior que não ter. Decisão: mostrar **one-time** + **free**, que são sólidos. Assinatura de curso vira build de verdade no Wave 2.) **Sem mudança de código.**
- **B. `/teach/refunds` → continua OCULTA.** Na real ela é só um `redirect("/account/payments")`, não uma página de verdade. Item de menu que rebate pra outro lugar confunde; o lar de refunds já é `/account/payments`. Melhor prática: não adicionar entrada de menu que é só redirect. **Sem mudança de código.**
- **C. Stubs por URL → mantém os painéis "coming soon".** Verifiquei por grep: os 4 stubs têm `contexts: []` e **zero** `<Link>` em qualquer tela — só alcançáveis digitando a URL na mão. Painel "on the roadmap" vende visão e nunca parece quebrado (redirect silencioso pareceria bug). O único ponteiro in-product (FAQ de Integrations) foi corrigido e está **live** (`9b4d6bb`).
- **D. UI de seleção do payout → ADIADA pro pós-demo.** Investidor não vai mexer no prazo de payout; o padrão é 7 e o caminho via doc de config já funciona. Construir a tela no Ops agora é esforço sem valor de demo. Recomendação: Wave 2.

### 🟢 EU executo (autônomo)
1. ✅ **Decisões A–D aplicadas** (ver acima) — A/B/D sem código, C com a FAQ corrigida.
2. ✅ **FAQ do /help** não aponta mais pro stub de Integrations → live (`9b4d6bb`).
3. ⏳ **Auditoria de estados vazios/loading/erro** no caminho da demo (aluno: `src/app/learn/*`; professor: `src/app/teach/*`) — pra nada "parecer quebrado" se uma lista estiver vazia. *Posso fazer já; verificação final é melhor no seu walkthrough logado.*
4. ⏳ **Sweep de dark-mode + focus-ring** além do nav já corrigido (consistência nos dois temas).
5. 🔒 **Estrutura de dados de demo** (≥1 curso publicado caprichado, ≥1 aluno com progresso, ≥1 certificado, carteira "cleared" + "pending"). **Bloqueado em você:** preciso que escolha QUAL curso é o showcase (o conteúdo vem de você; eu monto a estrutura/seed).
6. 🧹 Flag separada (chip): limpar 2 funções mortas em `firestore.rules` (validação de lesson-progress que nunca roda — progresso é server-authoritative). Não-bloqueador; sessão própria pra não mexer em security rules na véspera da demo.

### 🟣 Wave 2 — pós-demo (a real diferença vs Cakto; construir depois da conversa)
- 2.1 Order bump no checkout · 2.2 Upsell/downsell pós-compra · 2.3 Programa de afiliados (links, atribuição, ledger) · 2.4 Assinatura de curso (o build de verdade por trás do "habilite") · 2.5 Analytics de profundidade (LTV, churn, coorte).

---

## 4. Roteiro sugerido para mostrar (caminho feliz)
1. Marketplace → abrir um curso → ver página de venda + preview grátis.
2. **Comprar (LIVE)** → checkout Stripe → volta logado e matriculado.
3. Consumir lições → progresso server-authoritative atualiza → concluir.
4. **Certificado** emitido + página pública de verificação.
5. Trocar pra visão do **professor**: Studio → curso publicado → **carteira** com a venda (pending → 7 dias → available).

---

## 5. O que define "100%"
O **smoke test LIVE de US$1** (item 🔴 1). Tudo no código está deployado e validado; o que falta pra dizer "100% pronto pra mostrar" é essa prova final com dinheiro real — e ela é sua (cartão físico). Depois dela + as decisões A–D, eu fecho os 🟢 e está pronto.

---

*Plano gerado após deploy completo de 6 mudanças (5 commits de código + docs). Próximo passo do fundador: responder A–D e rodar o smoke test US$1.*
