# PROMPT — Ciclo de Melhoria Contínua · SkillsetUSA

> Cole isto numa sessão do Claude Code aberta DENTRO de
> `C:\Users\nicae\aiox-core\projects\skillset-foundation`.
> O prompt encadeia as skills certas, fase por fase. Não tente rodar tudo de uma vez —
> ele te faz parar e aprovar antes de codar.

---

Você é meu parceiro de engenharia/produto na SkillsetUSA (Next 16 + Firebase).
Objetivo: encontrar e fechar as lacunas que deixam a plataforma atrás dos concorrentes —
no front-end E no back-end. Trabalhe UM item por vez, sem big bang.

## FASE 0 — Contexto real (não pule)
Leia: BLOCKERS.md, HANDOFF.md, DECISIONS.md, TEST_RESULTS.md, STRIPE_CHECKLIST.md.
Me devolva 5 bullets: estado atual + o que já se sabe que está pendente.

## FASE 1 — Auditoria interna (front + saúde do código)
- Rode `/health` para um raio-x do código.
- Rode `/design-review` focado em: layout, hierarquia visual, responsividade,
  estados (loading / vazio / erro), microinterações e consistência do design system.
- Se houver fricção de DX, rode `/devex-review`.
Saída: lista de problemas FRONT + BACK, cada um com severidade (alta/média/baixa).

## FASE 2 — Benchmark de concorrentes
Concorrentes: [EU TE PASSO — se eu não passar, me peça 3 nomes/URLs antes de seguir].
- Para cada concorrente, use `website-intelligence` (ou `firecrawl_scrape`) para capturar:
  onboarding, navegação, página de curso, checkout/pricing.
- Rode `competitive-analysis` comparando SkillsetUSA × concorrentes.
Saída: tabela "eles têm / nós não temos", já priorizada.

## FASE 3 — Backlog priorizado (NÃO comece a codar)
- Consolide as Fases 0–2 num backlog único.
- Pontue cada item: Impacto (1–5) × Esforço (1–5) → score.
- Salve em `docs/BACKLOG-MELHORIA-AAAA-MM-DD.md`.
- Mostre o TOP 10 no chat e PARE para eu aprovar.

## FASE 4 — Plano executável (só após eu aprovar)
- Pegue os 3 itens de maior score.
- Rode `/gsd:plan-phase` para cada um (regra GSD: planejar antes de executar).
- Front: aplique `vercel:shadcn` + `vercel:react-best-practices` e o `emil-design-eng` no polimento.
- Back (Firebase/Firestore/functions): respeite `firestore.rules` e os testes do Vitest.

## FASE 5 — Construir + validar (item a item)
- Implemente UM item por vez.
- Antes de cada commit: `/code-review` no diff + rode os testes (Vitest) + `/qa` nos fluxos tocados.
- Não suba nada que quebre o TEST_RESULTS.

## FASE 6 — Ship
- `/ship` com verificação. Atualize HANDOFF.md e BLOCKERS.md ao final.

## REGRAS
- Não altere nada fora do plano aprovado.
- Mostre o backlog ANTES de construir.
- Se eu não passar concorrentes, me pergunte 3 antes da Fase 2.
- Um item por vez. Nada de reescrever tudo.
