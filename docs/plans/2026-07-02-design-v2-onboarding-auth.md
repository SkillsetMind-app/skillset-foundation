# Design V2 — Onboarding, Auth e superfícies de entrada

> Data: 2026-07-02 · Branch: feat/design-v2 · Autor: sessão de UX sweep com Patrick

## Direção de design (destilada das 4 referências do Patrick)

Referências: InsideBox (auth split-screen), Google Workspace (signup estreito),
modal dark glass, Predis.ai (onboarding com barra de progresso).

| Princípio | Regra prática |
|---|---|
| Escala contida | Conteúdo de formulário/etapa cabe na viewport SEM scroll (alvo: 730px de altura útil). Título de etapa ≤ 24px; corpo 13–14px. |
| Uma pergunta por tela | Cada etapa do wizard resolve UMA decisão. Nada de empilhar seções. |
| Progresso visível | Barra fina + "Step N of M" no topo, não pills largas. |
| Cartão estreito | Formulários em coluna de ~480–640px. Split-screen (foto + form) só em ≥ lg. |
| Respiro, não gordura | Whitespace vem de margens entre grupos, não de padding interno gigante nos cards. |
| Dark mode é tema, não filtro | Toda superfície nova precisa do par `[data-theme="dark"]` no mesmo commit. Gradientes claros hardcoded são proibidos sem override dark. |

## O que já foi corrigido nesta sessão (feat/design-v2, local)

1. **Crash de realtime** que derrubava toda página autenticada (Painel → página de erro): canal Supabase único por assinatura em `src/lib/supabase/client.ts` (commit c366888).
2. **Placeholder com nome pessoal** (`patrick-simon`) no onboarding → `your-name` (`onboarding-choice.tsx`).
3. **Dark mode ilegível no dashboard**: `.platform-shell-root` tinha gradiente começando em `#f8fbff` sem override dark → adicionado `[data-theme="dark"] .platform-shell-root` em `globals.css` (~linha 2091).
4. **Onboarding não cabia na tela**: pills de etapa → barra de progresso fina + "Step N of 3"; título 36px→24px; cards compactados; PROFILE com nome+username lado a lado; GOALS em grid 2 colunas. Os 3 passos agora cabem em 730px de altura (verificado no preview).
5. **Varredura de rotas**: 24 rotas públicas + sidebar do app testadas → todas 200, zero error boundary, console limpo. Botão Painel verificado clicando de verdade.

## Backlog priorizado (não feito)

### P1 — antes do deploy
- [ ] **Deploy**: produção ainda roda o código velho — TODOS os bugs que o Patrick screenshotou continuam lá até publicar (fix do realtime + estes fixes de design).
- [ ] **Idioma misturado**: homepage em PT-BR, dashboard/onboarding em EN ("Complete seu perfil" + campos "Public name"). Decidir: traduzir onboarding+dashboard via i18n existente (`getServerTranslation` já está no projeto) ou padronizar EN. Recomendação: PT-BR em tudo que o aluno vê.
- [ ] **Rebrand SkillsetUSA → SkillsetMind**: lockup hardcoded em `platform-shell.tsx` (`/brand/skillset-usa-lockup.png`, alt "Skillset USA") e demais assets em `/brand/`. Aguarda os assets novos da marca.

### P2 — polish
- [ ] **Auth (login/signup)**: aplicar a mesma compactação do onboarding (o `AuthShell` é compartilhado — margens já apertadas nesta sessão; falta revisar densidade interna dos forms de login/signup).
- [ ] **Homepage escala**: headings display muito grandes em viewports menores; revisar `clamp()` dos títulos hero.
- [ ] **Sweep dark mode por página**: visitar cada superfície em dark e caçar mais gradientes/fundos claros hardcoded (a lista de `#ffffff` em `globals.css` é grande; a maioria já tem par dark, mas conferir visual página a página).
- [ ] **Streamlined teacher activation** (tela única de ativação de professor em `onboarding-choice.tsx`): ainda com o estilo antigo de cards gordos; aplicar a mesma linguagem compacta.

### P3 — sofisticação (fase 2 do design)
- [ ] Micro-interações nos cards de seleção (check animado à la Predis).
- [ ] Transição entre etapas do wizard (slide/fade curto, respeitando `prefers-reduced-motion`).
- [ ] Ilustração/foto contextual por etapa no painel esquerdo do split-screen (hoje a foto é estática).

## Regra de aceitação para novas telas

Antes de dar uma tela por pronta: (1) cabe em 730px de altura sem scroll no
fluxo de formulário; (2) legível em dark mode; (3) copy no idioma padrão; (4)
zero texto pessoal do fundador como exemplo/placeholder.
