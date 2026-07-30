# Pivô para Cobrança Direta (Stripe Direct Charges)

> **Data:** 2026-07-24
> **Decisão do fundador:** a plataforma deixa de ser intermediária financeira. O comprador
> paga **direto** na conta Stripe do vendedor; o vendedor recebe **direto**. A Stripe faz o
> trabalho de repasse que hoje a plataforma faz à mão.
> **Consequência estrutural:** sem dinheiro nosso em trânsito, não existe base para
> afiliados nem coprodutores.

## STATUS DE EXECUÇÃO (2026-07-24)

| Fase | Status | Commit |
|---|---|---|
| 1 — Núcleo financeiro (backend) | ✅ feito | `3f23fcd` |
| 2 — Banco | ✅ **aplicada** em `ijtikldtjvsbtwszokvs` | `eb0ec66` |
| 3 — Frontend | ✅ feito | `b83165a` |
| 4 — Copy pública e legal | ✅ feito | `eb0ec66` + `056b849` |
| 5 — Verificação | ✅ typecheck + lint limpos, 61 suítes / 300 testes verdes | — |

### Fase 2 — o que o banco real revelou

O pré-voo mostrou que **produção já estava na forma pós-pivô**, e que o repositório é que
estava fora de sincronia com ela:

| Checagem | Esperado pelo plano | Encontrado em produção |
|---|---|---|
| `course_coproducers` | tabela com linhas a migrar | **não existe** |
| colunas `affiliate_*` em `course_commerce_settings` | 3 colunas | **nenhuma** — a tabela já era só imposto |
| `upsert_course_commerce_settings` | 7 argumentos | **4 argumentos**, corpo byte-a-byte igual ao da migração |
| `payout_ledger` | linhas retidas a acertar | **0 linhas** |
| `orders` | vendas a reconciliar | **0 pedidos** — a plataforma nunca vendeu |

Efeito líquido da migração em produção: **o comentário na `payout_ledger`**. Ela foi mantida
no repositório porque um ambiente novo, construído a partir de
`20260710_course_commerce_operations.sql`, **cria** o schema de afiliado — é esta migração que
converge esse ambiente para cá. Todo `drop` é guardado e re-executável.

### Bug de produção encontrado no caminho

O data layer chamava a RPC com **7 parâmetros nomeados** contra uma função que em produção
só aceita **4**. PostgREST resolve RPC por nome de argumento: os três `p_affiliate_*`
inexistentes faziam a chamada falhar com `PGRST202` (função não encontrada no schema cache).

**Salvar configuração de imposto num curso estava quebrado em produção.** Corrigido em
`src/lib/data/course-commerce.ts` (parâmetros fixados removidos) e `database.types.ts`
alinhado à mão com o schema real — os tipos gerados ainda declaravam `course_coproducers`,
as colunas de afiliado e a assinatura de 7 argumentos.

### Sobra no banco, ainda não tratado

`claim_payout_transfer_reversal` e `complete_payout_transfer_reversal` continuam em produção.
São funções do modelo antigo — sob cobrança direta não existe transfer para reverter. Estão
mortas, não quebram nada, e sair dropando função de dinheiro sem necessidade é risco à toa.
Ficam para uma limpeza deliberada.

---

## 1. AUDITORIA — o que existe hoje

### 1.1 Modelo financeiro atual (a ser substituído)

Hoje o `orders.payout_model` é literalmente `"separate_charges_and_transfers"`
(`src/app/api/payments/checkout/route.ts:535`). O fluxo é:

```
Comprador → cartão → CONTA DA PLATAFORMA (nós somos o merchant of record)
                          ↓ dinheiro parado 7 dias (payout_ledger, status in_release)
                          ↓ cron /api/cron/release-payouts
                     stripe.transfers.create → conta do professor
                          ↓ se houver reembolso depois: transfers.createReversal (clawback)
```

Isto é o oposto do que o fundador decidiu. Somos hoje custodiantes do dinheiro alheio.

| Peça | Arquivo | Papel hoje |
|---|---|---|
| Sessão de checkout | `src/app/api/payments/checkout/route.ts` (688 L) | Cria charge na conta da PLATAFORMA |
| Webhook | `src/app/api/webhooks/stripe/route.ts` (1576 L) | Escreve `payout_ledger`, liquida comissão de afiliado, faz clawback |
| Cron de liberação | `src/app/api/cron/release-payouts/route.ts` (340 L) | Solta a retenção de 7 dias via `transfers.create` |
| Regras de dinheiro | `src/lib/payments/rules.ts` (791 L) | Retenção, reversão proporcional, clawback de comissão |
| Ledger | `src/lib/data/payout-ledger.ts`, `src/domain/payout-ledger.ts` | Contabilidade da retenção |

### 1.2 Superfície de afiliados / coprodutores a remover

**328 ocorrências em 23 arquivos.** Núcleo:

| Camada | Arquivo | Peso |
|---|---|---|
| Domínio | `src/domain/affiliate-attribution.ts` (130 L) + teste (33 refs) | Atribuição de venda ao afiliado |
| Checkout | `src/app/api/payments/checkout/route.ts` | 32 refs — calcula comissão e injeta em metadata |
| Webhook | `src/app/api/webhooks/stripe/route.ts` | 41 refs — liquida e estorna comissão |
| Regras | `src/lib/payments/rules.ts` | `affiliateCommissionRefundTargetMinor` |
| Commerce | `src/domain/course-commerce.ts`, `src/lib/data/course-commerce.ts` | 48 refs |
| UI | `src/components/teacher/course-commerce-panels.tsx` | 53 refs |
| UI | `src/components/teacher/creator-affiliate-hub.tsx` (126 L) | Página inteira |
| Rota | `src/app/teach/affiliates/page.tsx` | Página inteira |
| Rota | `src/app/teach/co-productions/page.tsx` | Página inteira |
| Nav | `src/data/site.ts:232` e `:248` | Itens do menu lateral |
| i18n | `en.json:366,371` + `pt-br.json` + `es.json` | Rótulos |
| Banco | `courses.affiliate_enabled`, `affiliate_commission_pct`, `affiliate_approval` | Colunas |
| Banco | `course_coproducers` + RPCs `invite_course_coproducer` / `revoke_course_coproducer` | Tabela + funções |

### 1.3 Estado de dados ao vivo

O Stripe Connect **ainda não foi verificado** (perfil de plataforma pendente — gargalo nº1 de
receita registrado na memória do projeto). Logo **não existe venda real em produção**. A
migração pode ser feita de forma limpa, sem backfill de dados históricos.

> ⚠️ **Não pude confirmar isso por query.** O MCP do Supabase respondeu
> `Unauthorized` nesta sessão. A conclusão vem do estado do Connect, não de uma contagem de
> linhas. **Antes do deploy, confirmar no painel Stripe que não há charge em modo live.**

---

## 2. DECISÃO DE ARQUITETURA

### 2.1 Direct Charges

```
Comprador → cartão → CONTA STRIPE DO PROFESSOR (ele é o merchant of record)
                          ↓ Stripe desconta application_fee_amount automaticamente
                     nossa comissão cai na conta da plataforma
```

Implementação: `stripe.checkout.sessions.create(params, { stripeAccount: <conta do professor> })`
com `payment_intent_data.application_fee_amount`.

| Dimensão | Antes (separate charges + transfers) | Depois (direct charges) |
|---|---|---|
| Quem é o merchant of record | A plataforma | **O professor** |
| Quem segura o dinheiro | A plataforma, por 7 dias | **Ninguém** — vai direto |
| Taxa da Stripe | Paga pela plataforma | Paga pela conta do professor |
| Chargeback / disputa | Risco da plataforma | **Risco do professor** |
| Nossa receita | Transfer manual do líquido | `application_fee_amount`, automático |
| Comissão a terceiro (afiliado) | Possível | **Impossível** — nunca tocamos no dinheiro |

### 2.2 Por que isso é estrategicamente forte (além do pedido)

1. **Sai do risco de transmissão de dinheiro.** Custodiar dinheiro de terceiros é a
   exposição regulatória mais pesada de um marketplace. Direct charges eliminam.
2. **Elimina o clawback.** Toda a máquina de reversão proporcional de transfer
   (`releasedRefundReversalAmountMinor`, claims de concorrência, two-phase reservation)
   deixa de existir. É o código mais perigoso do repositório.
3. **Professor recebe mais rápido.** Sem retenção de 7 dias.

⚠️ **O que isso NÃO resolve:** o risco de *fee-splitting* estadual nos EUA (percentual sobre
receita de profissional de saúde) permanece — a `application_fee` continua sendo um % da
venda. Direct charges reduzem a exposição de custódia, não a de percentual. Fica registrado
como item jurídico separado, fora deste escopo.

### 2.3 O que morre por consequência

| Recurso | Motivo |
|---|---|
| Afiliados | A plataforma não tem mais o dinheiro para dividir com um terceiro |
| Coprodutores | Mesmo motivo |
| Retenção de 7 dias / `payout_ledger` | Não há mais dinheiro nosso a liberar |
| Cron `release-payouts` | Idem |
| Clawback de transfer | Reembolso passa a sair da conta do professor |

### 2.4 O que sobrevive (não confundir com afiliado)

| Recurso | Por quê |
|---|---|
| **Cupons** | Desconto no preço, não divisão de receita. Vive no charge direto. |
| **Parcelamento** | Opção de cartão na conta do professor. Segue igual. |
| **Assinaturas de curso** | Direct charge recorrente. Segue. |
| **Reembolsos** | Passam a ser emitidos NA conta do professor (`stripeAccount`). |
| **Escada de taxa 10/5/3/2%** | Vira `application_fee_amount`. Sem mudança de valores. |
| **Team & roles / Integrations** | Nunca foram financeiros. Continuam como roadmap. |

---

## 3. PLANO DE EXECUÇÃO

### Fase 1 — Núcleo financeiro (backend)
1. `checkout/route.ts`: trocar para direct charge (`{ stripeAccount }` +
   `application_fee_amount`); remover cálculo/metadata de afiliado; `payout_model` →
   `"direct_charge"`.
2. `webhooks/stripe/route.ts`: aceitar eventos Connect (`event.account`); remover escrita de
   `payout_ledger`, liquidação e estorno de comissão; reembolso deixa de reverter transfer.
3. `rules.ts`: remover reversão de transfer, claims de reversão e comissão de afiliado.
   Manter idempotência de webhook, lock de checkout e transições de status de pedido.
4. Excluir `api/cron/release-payouts` + teste.
5. Excluir `src/domain/affiliate-attribution.ts` + teste.
6. Rotas de reembolso: emitir na conta conectada.

### Fase 2 — Banco
7. Migração: dropar `course_coproducers` e as RPCs de coprodutor; dropar colunas
   `affiliate_*` de `courses`; marcar `payout_ledger` como descontinuada (**sem dropar** —
   preserva histórico e é reversível).
8. Regenerar `database.types.ts`.

### Fase 3 — Frontend
9. Excluir `/teach/affiliates`, `/teach/co-productions`, `creator-affiliate-hub.tsx`.
10. `site.ts`: remover os 2 itens do menu; seção "Partnerships" vira "Growth" (só cupons).
11. `course-commerce-panels.tsx`: remover painéis de afiliado/coprodutor.
12. i18n nos 3 idiomas.

### Fase 4 — Copy pública e legal
13. `fees-and-payouts`, `legal/terms`, `legal/teacher-terms`, `promise`, `trust`,
    `refund-policy`: trocar a narrativa de "nós retemos e repassamos" por "você recebe
    direto da Stripe; nós cobramos uma taxa de plataforma". **Ponto sensível:** o professor
    passa a ser merchant of record e assume o risco de chargeback — isso precisa estar
    escrito nos termos do professor.

### Fase 5 — Verificação
14. `npm run typecheck`, `npm run lint`, `npm test` — tudo verde.
15. Relatório final honesto do que passou e do que não passou.

---

## 4. FORA DE ESCOPO (registrado, não executado)

| Item | Por quê |
|---|---|
| Verificação do perfil Connect na Stripe | Só o fundador pode fazer no painel |
| Rotação de `service_role` e chaves Stripe LIVE | Console, não código |
| Parecer jurídico sobre fee-splitting | Advogado, não engenharia |
| Vars do Bunny na Vercel | Segredos — o fundador cola |
