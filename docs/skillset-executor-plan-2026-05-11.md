# Skillset Executor Plan — 2026-05-11

**Objetivo:** Consolidar o trabalho da Fase 6 (31 commits presos em branch), responder a configuração/custos do Stripe Connect, e corrigir os defeitos reais de maior impacto, com qualidade de mercado.

**Arquitetura:** Next.js 16 + Firebase (Auth/Firestore/Storage/Functions) + Stripe Connect Express. Branch de trabalho `fase-6-organize` (build/lint/test verdes) → integrar em `main`.

**Dependências:** Firebase CLI autenticado (projeto `skillsetusaofficial`), Stripe LIVE account `acct_… (conta da plataforma)`.

---

## Diagnóstico verificado (estado real, não relatado)

- `git`: branch `fase-6-organize`, 31 commits à frente de `main`, 94 arquivos, +5801/-761. Working tree limpo. **NÃO mergeado, NÃO deployado.**
- `npm run build`: passa (71 rotas). `npm run lint`: passa. `npm test`: passa (11 arquivos, 33 testes). `functions build`: passa.
- **Segurança:** nenhum secret commitado no repo. `.gitignore` cobre `.env*`. `git grep` de padrões de chave em fonte rastreada = limpo. OK.
- **Stripe:** conta LIVE "SKILLSET USA" `acct_… (conta da plataforma)` — `charges_enabled`, `payouts_enabled`, `transfers: active`, **Connect já habilitado**, webhook LIVE já configurado na URL da Function com os 4 eventos certos. Stack de código está consistentemente em **TEST mode** (pk/sk/whsec de teste) — correto e seguro para a fase pré-QA.

## Defeitos reais encontrados

1. **P0 — Loop duplo de onboarding (teacher):** `OnboardingWizard.finishOnboarding()` roteia teacher para `/onboarding?path=teacher` (página antiga `OnboardingChoice`) que repergunta path/profile/goals. Wizard novo já coletou tudo. UX redundante, abaixo do padrão de mercado. Student funciona (vai direto `/learn`).
2. **P1 — Rotas órfãs:** `/onboarding` e `/platform` ainda existem (cruft). Plano original pedia depreciação; Codex adiou (documentado em `agent-status.md`).
3. **P1 — Itens não verificados pelo Codex (admitido em completion report):** Lighthouse não rodado, sem QA de browser, fluxos reais Firebase/Stripe não exercitados, console-clean não verificado, contraste do dark mode não revisado.
4. **P2 — `getPostAuthRoute` reforça o loop:** retorna `/onboarding?path=teacher` quando `onboardingPath==='teacher' && !roles.includes('teacher')`.

---

## Task 1: Consolidar Fase 6 em main

**Arquivos:** branch `fase-6-organize` → `main`

**Step 1:** Confirmar verde: `npm run lint && npm test && npm run build && npm --prefix functions run build`
**Step 2:** `git checkout main && git merge --no-ff fase-6-organize`
**Step 3:** `git push origin main` (se remoto acessível; senão, deixar local e reportar)
**Step 4:** Verificar `git log --oneline -3`

## Task 2: Stripe go-live runbook + resposta de custo

**Arquivos:** Criar `docs/stripe-go-live-runbook.md`

**Step 1:** Documentar resposta de custo (Connect grátis; custos por transação)
**Step 2:** Documentar cutover TEST→LIVE em comandos exatos
**Step 3:** Documentar passo de obtenção do `whsec_` LIVE

## Task 3: Corrigir loop duplo de onboarding (P0)

**Arquivos:** Modificar `src/components/auth/onboarding-wizard.tsx`, `src/lib/auth/routing.ts`

**Step 1:** Wizard: ao finalizar com path=teacher, rotear para `/onboarding?path=teacher` mantido APENAS como gate de Teacher Terms (não re-perguntar). Solução mínima e segura: manter o gate de segurança (email verificado + Teacher Terms) mas a página antiga deve detectar `onboardingAnswers` presente e renderizar somente a etapa de ativação (sem repetir path/profile/goals).
**Step 2:** Verificar build
**Step 3:** Atualizar `docs/changelog.md` e `docs/agent-status.md`

## Task 4: Verificação final

**Step 1:** `npm run lint && npm test && npm run build`
**Step 2:** Atualizar este plano com status real
**Step 3:** Relatório final ao founder

---

## Decisões deliberadas (não fazer)

- **NÃO** flipar Stripe para LIVE agora: produto sem QA de browser = risco crítico de dinheiro real em fluxo bugado. Runbook deixa cutover como operação de 5 min quando QA passar.
- **NÃO** deployar production nesta sessão: merge em main + deploy staging primeiro; production exige QA de browser (responsabilidade explícita do go-live).
- **NÃO** deletar `/onboarding`/`/platform` agora: rotas órfãs são P1, não bloqueiam; remoção precisa de redirect testado para não quebrar fluxos ativos.
