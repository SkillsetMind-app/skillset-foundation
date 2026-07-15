# HANDOFF — Continuação Grok (Claude → Codex → Grok)

> **Criado:** 2026-07-15 · **Modo:** ponytail full + GSD slim  
> **Regra anti-travamento:** 1 worktree · 1 fatia · verde · commit · só então próxima

---

## Cadeia de continuidade

```
Claude (descoberta Hotmart + backlog) 
   → Codex thread 019f388d… (logos + commerce + subscriptions)
      → Grok (esta sessão) — FECHAR WIP do worktree
```

**Não reabrir** logo pack, platform rewrite, nem schema Supabase inteiro nesta fatia.

---

## Onde estamos (fato em disco)

| Item | Valor |
|------|--------|
| Repo | `aiox-core/projects/skillset-foundation` |
| Worktree | `.claude/worktrees/issue-8-creator-subscriptions` |
| Branch | `feat/issue-8-creator-subscriptions` @ `2b6bdea` |
| Já commitado | #4 create subscription product · #6 invoice → order/payment |
| WIP **não commitado** | Creator Subscription Center + metrics + nav + i18n + wallet tweaks |
| GSD | Phase 1 vídeo OK · Phase 2 commerce 02-01/02-02 OK · **próximo = subscriber ops / MRR** (era item 3 do STATE) |

### Arquivos WIP (fechar isto)

- `src/app/teach/subscriptions/` (página)
- `src/components/teacher/creator-subscription-center.tsx` + test
- `src/domain/creator-subscriptions.ts` + test
- mods: `platform-nav`, `status-chip`, `sale-list`, `teacher-wallet-panel`, i18n, `site.ts`, data layer
- evidence screenshots em `.planning/phases/02-commerce-integrity/evidence/`

---

## Processo pra NÃO travar (ponytail full)

### Gate 0 — Contexto (1x, 10 min max)
1. Ler este HANDOFF + `STATE.md` (só “Next execution order”).
2. **Não** reler transcript Codex inteiro (243 MB). Só se faltar um arquivo.

### Gate 1 — Fatia atual (única)
**DONE quando:**
1. `vitest` passa nos testes de subscription center + domain (+ suite se rápida).
2. Sem erro de TypeScript nos arquivos tocados.
3. Diff revisado: só commerce/subscribers.
4. **Commit atômico** no worktree (mensagem: `feat: creator subscription center + MRR metrics`).

### Gate 2 — Parar e reportar
Depois do commit: **parar**. Mostrar:
- o que entrou
- o que ficou de propósito de fora (schema RPC, backfill Stripe, product/offers)
- 1 próximo passo opcional

### Proibido nesta rodada (YAGNI)
- Reescrever hotmart clone inteiro
- Logo SkillsetMind (já tem 19 PNGs no Codex; pacote depois)
- Migrar todo schema Supabase
- “Melhorar a plataforma toda”
- Multi-worktree / multi-branch em paralelo

---

## Ordem de execução (checklist)

```
[ ] 1. cd worktree issue-8
[ ] 2. vitest creator-subscriptions* 
[ ] 3. Corrigir só o que quebrar (menor diff)
[ ] 4. git add (código + evidence se limpos) 
[ ] 5. commit
[ ] 6. atualizar STATE.md (marcar item 3 subscriber ops como shipped WIP)
[ ] 7. handoff de 5 linhas pro Patrick
```

---

## Próximas fatias (DEPOIS, uma por sessão)

| # | Fatia | Só quando |
|---|--------|-----------|
| A | Schema/RPC baseline versionado | acesso Supabase |
| B | Backfill invoices históricos | Stripe auth |
| C | Product/offers/prices | A estável |
| D | Pacote logo SVG formal | pedido explícito |

---

## Comandos úteis

```powershell
cd C:\Users\nicae\aiox-core\projects\skillset-foundation\.claude\worktrees\issue-8-creator-subscriptions
npx vitest run src/domain/creator-subscriptions.test.tsx src/components/teacher/creator-subscription-center.test.tsx
npx tsc --noEmit
git status -sb
```

---

*Grok assume este worktree. Não misturar com `feat/issue-2-hybrid-video` do main checkout.*
