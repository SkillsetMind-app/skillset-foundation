# Auditoria Claude → Codex → Grok

**Data:** 2026-07-15  
**Branch:** `feat/issue-8-creator-subscriptions`  
**Escopo:** demanda de continuidade da sessão Codex `019f388d…` + backlog Hotmart/Skillset

---

## Demanda original (resumo)

| # | Pedido (Claude/Codex) | Status | Evidência |
|---|----------------------|--------|-----------|
| 1 | Assinatura como formato de produto na criação de curso | **DONE** | commit `27f78cc` / #4 |
| 2 | Invoice paid materializa order/payment (fatos financeiros) | **DONE** | `2b6bdea` / #6 |
| 3 | Centro de assinantes + MRR/churn | **DONE** | `a0b74ef` |
| 4 | Schema/RPC versionado no repo | **PARTIAL** | baseline tables `5b3d717` + live inventory `501fbd0` (42 tables); SQL de functions/RLS ainda inventário, não dump `CREATE FUNCTION` |
| 5 | Backfill invoices históricos | **DONE (no-op)** | dry-run: 0 invoices Stripe live, 0 rows commerce |
| 6 | Product/offers/prices sem quebrar legacy | **DONE (base)** | domain dual-read + checkout wired (`normalizeCoursePrice` + offers stub) |
| 7 | Ops globais creator (wallet/metrics/growth) | **DONE (hub)** | `/teach/operations` + `creator-ops` rollup |
| 8 | Logos SkillsetMind (início da sessão Codex) | **OUT OF SCOPE desta branch** | 19 PNGs em `~/.codex/generated_images/019f388d…` — não packaging SVG formal |
| 9 | Paridade Hotmart completa (coupons/coproducer/tax/affiliate matrix) | **OPEN** | coupons/coproducer UI paths existem; deep parity residual |
| 10 | Schema RPC full bodies versionados | **OPEN** | 14+ RPCs app sem SQL completo no repo |
| 11 | Live dump SQL (`supabase db dump`) | **OPEN** | precisa DB password; REST inventory feito |

---

## O que Grok entregou nesta continuidade

### Commerce / subscriptions
- Creator Subscription Center UI + tests
- Dual-read pricing domain + checkout integration
- Creator ops hub + domain metrics rollup
- Nav: Operations hub, Sales, Subscriptions

### Database / credentials
- Mapped vault freeform keys (Skillset vs Lugano vs dead host)
- Validated keys: Stripe live PASS, Supabase live PASS (`ijtikldtjvsbtwszokvs`, 42 tables)
- Live inventory + backfill dry-run reports

### Commits (worktree)
```
(pending P4/P5 commit)
501fbd0 docs(db): live schema inventory + backfill dry-run
beae9fe feat(commerce): dual-read product pricing domain
5b3d717 feat(db): schema baseline tables from types
a0b74ef feat(teacher): creator subscription center + MRR
2b6bdea / 27f78cc (Codex) financial facts + create subscription product
```

---

## Gaps / correções recomendadas

| Prioridade | Item | Por quê |
|------------|------|---------|
| P0 | Confirmar `.env.local` Skillset host `ijtikld…` em deploy Vercel | host antigo `bwbgcuj…` está morto |
| P1 | Versionar bodies dos RPCs críticos (`claim_checkout_lock`, `enforce_rate_limit`, builder RPCs) | app chama, migrations incompletas |
| P1 | `supabase db dump` com senha do DB Skillset | RLS/functions reais |
| P2 | Tabelas `product_offers` / `product_prices` + loader real | dual-read hoje sempre legacy até migration |
| P2 | Pacote logo SVG a partir dos 19 PNGs Codex | demanda inicial da sessão, não desta branch |
| P3 | Teste E2E checkout assinatura (Stripe test) | conta live vazia; validar webhook de ponta a ponta |
| P3 | Pre-commit npm hook quebrado (`could not determine executable`) | ruído em todo commit |

---

## Veredito

**Demanda principal de continuidade Codex (assinaturas + commerce integrity + ops creator):** cumprida no essencial.

**Não cumprido / residual:** paridade Hotmart total, dump SQL completo de functions, packaging de logo, multi-offer DB tables.

**Risco residual baixo** no código shipping de subscriptions; **risco operacional** se deploy ainda apontar Supabase host morto.

---

## Próximo passo sugerido (uma fatia)

1. Migration tipada `product_offers`/`product_prices` **ou**  
2. RPC dump/versioning dos 5 RPCs de checkout **ou**  
3. E2E assinatura em Stripe **test** mode
