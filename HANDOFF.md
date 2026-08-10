# HANDOFF — sessão autônoma 2026-05-19

## 2026-05-25 - Fase 2 / Bloco B - Pagamentos criticos

Feito:
- Extraido `functions/src/payment-rules.ts` com regras testaveis de pagamento.
- Payout release alterado de D+7 para D+10, mantendo auto-refund em 7 dias. _(Histórico — payout final reconciliado para **D+30** em 2026-06-06; ver DECISIONS.md D21.)_
- Estimativa Stripe non-USD alterada para 5.4% + fixo; USD mantido em 2.9% + fixo.
- Comissao unificada por plano no servidor: Free 800 bps, Starter 400, Pro 100, Plus 0.
- `createTeacherCourseDraft`, `updateTeacherCourseBuilder` e checkout pago agora resolvem bps pelo plano real do professor no servidor, nao pelo cliente.
- `requestRefund` passou de busca `userId + limit(50) + filtro em memoria` para query direta `userId + courseId + status paid`.
- `charge.refunded` agora cria reversal proporcional quando o payout ledger ja foi `released` e existe `transferId`, com idempotency key.
- Docs existentes de split/fees atualizadas para nao continuar comunicando 15%/3.9% como regra atual.

Validado:
- `npx tsc --noEmit --pretty false --types vitest/globals` OK.
- `npm run lint` OK.
- `npm test` OK: 16 arquivos, 61 testes.
- `firebase emulators:exec --project demo-skillset --only firestore "npm run test:rules:run"` OK: 7 regras.
- `npm --prefix functions run build` OK.
- `npm run build` OK.

Bloqueio registrado:
- B8 em `BLOCKERS.md`: falta `STRIPE_SECRET_KEY` local para validar os 6 Stripe Price IDs na API real. O codigo manteve os IDs existentes e nao inventou novos.

Proximo bloco:
- Bloco C: varrer consistencia de UI/dados migrados, sem mockData, garantindo enrollment/autor/status coerentes.

Tratamento normal (sem "senhor"). Padrão de code review sênior aplicado.
Tudo validado e no GitHub. **Nada foi deployado** (deploy/LIVE = sua decisão).

## ✅ Concluído (P1 — 100%, com padrão de produção)

| Item | Estado | Commit |
|---|---|---|
| Taxa Stripe repassada ao professor | feito + testado | `01e8d5b` |
| Hold de payout 30 → 7 dias _(histórico; valor final = **30**, ver DECISIONS D21)_ | feito | `01e8d5b` |
| `stripeFeeMinor` persistido no ledger | feito | `01e8d5b` |
| Módulo canônico `payment-split.ts` + 9 testes unitários _(histórico; o módulo foi **apagado** na virada para direct charges — a cobertura de taxa vive hoje em `src/lib/payments/rules.ts`)_ | feito | `978f63a` |
| Bug foto: erros deixam de ser engolidos, causa observável + fallback robusto | feito | `0a48290` |
| Retrofit: 8 catches de métricas agora logam com contexto (padrão #3) | feito | `5071f44` |
| STRIPE_CHECKLIST.md / TEST_RESULTS.md / script sim / BLOCKERS / DECISIONS | feito | `0a07b33` |
| INSPIRATION_SPEC.md (P2/P3/P5/P6) | feito | (este commit) |

Validação final: **lint 0 · 42/42 testes · next build OK · functions tsc OK.**
Split conferido: $100 USD → professor $81.80, plataforma $15.00, Stripe $3.20.

## ✅ Concluído (continuação — "pode fazer o que falta")

| P | Item | Estado | Commit |
|---|---|---|---|
| P4 | E-mail de verificação: já existia (envio + UI de reenvio); removido o `.catch(()=>undefined)` que escondia falha | feito (reuso, não recriado) | `df48d33` |
| P2 | Homepage single-page: header com scroll-âncora; `SiteNav` com prop tipada opcional; 4 seções com `id`+`scroll-mt`; smooth-scroll guardado por reduced-motion | feito + verificado ao vivo (home 200, âncoras no HTML) | `ba3fc5c` |

Validado: lint 0 · 42/42 testes · build OK. Zero regressão fora da home
(prop opcional; demais páginas não passam `landingNav`).

## ✅ Concluído (3ª leva — "pode avançar")

| P | Item | Estado | Commit |
|---|---|---|---|
| P3 | Onboarding: wizard real (`OnboardingWizard`) reduzido — até 7→ **2 (aluno) / 3 (professor)** perguntas; progress indicator corrigido p/ total real; perguntas removidas mantidas no código (reativáveis em 1 linha) | feito | `f95f310` |
| P5+P6 | Contrato da sidebar: já era colapsável (reforma); faltava ficar **fixa sem cortar** — `align-self:start` + `max-height`/`overflow` na shell compartilhada → atende professor E aluno | feito | (este commit) |

Validado a cada passo: lint 0 · 42/42 testes · build OK. Sem deletar nada
referenciado (`OnboardingChoice` /onboarding preservado — regra #1).

## ⏳ Trabalho futuro opcional (não bloqueante)

Polimento de conteúdo específico dos dashboards (cards extras das telas
Cakto além dos `*-overview-metrics` já existentes). Casca + contrato de
layout + métricas reais já entregues. Spec: `docs/ai-handoff/INSPIRATION_SPEC.md`.
Decisões D6/D9/D10 explicam o que foi reduzido/estendido vs reconstruído.

## ⛔ Bloqueado (precisa de você) — passo exato

Tudo detalhado em **`BLOCKERS.md`**. Resumo:
- **B1/B2/B3 — Stripe LIVE**: chaves + webhook secret estão no Claude Desktop
  (sem acesso). Siga `STRIPE_CHECKLIST.md` (campo por campo, onde clicar).
- **B6 — causa-raiz da foto de perfil**: `npm run dev` → trocar foto com
  DevTools/Console aberto → me mande a mensagem de erro real (agora ela
  aparece; antes era engolida). Fecho a causa em 1 fix.
- **B4 — e-mail**: NÃO bloqueia (usei Firebase nativo). Só se quiser template
  custom depois.

## 🧠 Decisões que tomei sozinho

Detalhe em **`DECISIONS.md`** (D1–D6). Destaques:
- D2: mantive `separate_charges_and_transfers` (sem `application_fee_amount`);
  fee refletido no transfer. Mudar arquitetura de cobrança sem você = risco.
- D5: bug da foto — corrigi defeitos provados + tornei observável; não
  "consertei no escuro" nem aleguei resolvido sem verificar.
- D6: P1 sólido > P2–P6 superficial. P2–P6 ficaram **especificados**
  (`docs/ai-handoff/INSPIRATION_SPEC.md`), não implementados às pressas.

## ▶️ Recomendado para a próxima sessão

1. Desbloquear B6 (5 min) — me dá o erro real do console; fecho o bug da foto.
2. Desbloquear B1–B3 — chaves Stripe TEST → rodar `scripts/stripe-test-e2e.mjs`
   em LIVE-TEST → validar split real → cutover LIVE.
3. P2 (homepage scroll single-page) seguindo INSPIRATION_SPEC — é o maior
   valor visível e não depende de você.
4. P3 onboarding reduzido (4–5 passos) + P4 e-mail nativo (já decidido).
5. P5/P6 dashboards (estender `platform-shell`/`platform-nav` já reformados).

## ⏱️ Esforço relativo por P (não horas reais)

- **P1**: ~85% do esforço da sessão (código + testes + validação + docs + bug).
- **P2–P6**: ~15% — análise de telas + spec acionável (implementação adiada
  conscientemente, ver D6).

## Estado git
`main` à frente do remoto anterior; pushes: `01e8d5b`, `0a07b33`, `978f63a`,
`0a48290`, `5071f44` (+ commit destes docs). Sem force push, sem reset,
nada deletado. Servidor dev pode ainda estar rodando em :3000 (background).

## 2026-05-25 - Fase 2 / Bloco A - Course Builder funcional

Estado: concluido e validado.

Feito:
- Branch de trabalho criada: `fase-2-builder-backend`.
- Confirmado que nao existe uso de `window.SkillsetData`, `mockData` ou `data.js`.
- `CreateCourseModal` deixou de criar draft com resumo padrao hardcoded; agora exige `Course promise` real do professor e envia esse valor para `createTeacherCourseDraft`.
- `CourseBuilderStudio` separa progresso de etapa (`Builder step X of 4`) de readiness de revisao, evitando o estado confuso tipo "step atual + percentual global".
- Upload de video/material agora fica bloqueado para aulas criadas apenas no estado local. A aula precisa ser salva no draft primeiro, aparecer no Firestore, e so entao libera `Open lesson studio` para upload via `course-assets.ts`.
- Fluxo real confirmado: `createTeacherCourseDraft`, `updateTeacherCourseBuilder`, `submitTeacherCourseForReview`, `uploadCourseAsset`, Firebase Storage e subcolecao `courses/{courseId}/assets`.

Validacao:
- `npx tsc --noEmit --pretty false --types vitest/globals`: passou.
- `npm run lint`: passou.
- `npm test`: 15 arquivos / 55 testes passaram.
- `npm run build`: passou.
- `npm run test:rules`: 7 testes passaram.
- `npm --prefix functions run build`: passou.

Proximo bloco:
- Bloco B: corrigir pagamentos em `functions/src/index.ts`, com testes Vitest.

## 2026-05-25 - Fase 2 / Bloco C - Consistencia de dados da learning UI

Estado: concluido e validado.

Feito:
- Confirmado que nenhum componente importado do Design V2 le `window.SkillsetData`, `mockData` ou `data.js`.
- `Continue learning` agora usa apenas enrollments `active`; cursos `completed` continuam abrindo na biblioteca, mas nao aparecem como curso em andamento.
- Metricas de aluno passaram a contar `Courses in progress` apenas com status `active`.
- `LearnCommunityHub` deixou de misturar comunidades de catalogo demo; a lista agora deriva somente de enrollments reais do usuario.
- Rota legada `/learn/community/[slug]` preservada sem importar catalogo demo; ela monta um espaco generico pelo slug real e deixa o gate de enrollment validar acesso.

Validacao:
- `npx tsc --noEmit --pretty false --types vitest/globals`: passou.
- `npm run lint`: passou.
- `npm test`: 16 arquivos / 63 testes passaram.
- `npm run build`: passou.
- `firebase emulators:exec --project demo-skillset --only firestore "npm run test:rules:run"`: passou apos rerun isolado; primeira tentativa foi timeout de inicializacao do emulator.
- `npm --prefix functions run build`: passou.

Proximo bloco:
- Bloco D: validar gate pos-compra para classroom/video protegido contra `storage.rules`.

## 2026-05-25 - Fase 2 / Bloco D - Gate de acesso pos-compra e Storage

Estado: concluido e validado.

Feito:
- Adicionado teste automatizado de `storage.rules` para assets protegidos de curso.
- Validado que professor dono consegue subir video de aula no path real `courses/{courseId}/assets/{ownerId}/{assetId}/{fileName}`.
- Validado que professor nao-dono nao consegue subir arquivo em curso de outro professor.
- Validado que aluno com enrollment `active` consegue ler video/material protegido.
- Validado que aluno sem enrollment nao consegue ler video/material protegido.
- Script `npm run test:rules` agora sobe Firestore + Storage em projeto demo fixo para que `firestore.get()` dentro de `storage.rules` aponte para o mesmo namespace dos seeds.
- `vitest.rules.config.ts` roda arquivos de rules sem paralelismo para evitar `clearFirestore()` concorrente entre suites.

Validacao:
- `npx tsc --noEmit --pretty false --types vitest/globals`: passou.
- `npm run lint`: passou.
- `npm test`: 16 arquivos / 63 testes passaram.
- `npm run test:rules`: 2 arquivos / 11 testes passaram.
- `npm run build`: passou.
- `npm --prefix functions run build`: passou.

Estado final:
- Blocos A, B, C e D concluidos na branch `fase-2-builder-backend`.

## 2026-05-25 - Main integrado + Stripe go-live prep

Estado: concluido.

Feito:
- Branch `fase-2-builder-backend` integrada em `main` com merge commit.
- `main` enviado para GitHub.
- Validado em `main`: TypeScript, lint, testes unitarios, rules tests, build Next e build Functions.
- Credenciais locais lidas sem expor valores.
- `STRIPE_SECRET_KEY` LIVE e `STRIPE_WEBHOOK_SECRET` gravados no Firebase Secret Manager.
- 6 Price IDs de planos confirmados como ativos no Stripe LIVE.
- Frontend confirmado com publishable key LIVE em `.env.local` e `.env.production`.

Pendente imediato:
- Nenhum deploy pendente deste bloco.

Deploy:
- `firebase deploy --only functions --project skillsetusaofficial`: concluido.
- `firebase deploy --only "hosting,firestore:rules,storage" --project skillsetusaofficial`: concluido.
- Hosting publicado em `https://skillsetusaofficial.web.app`.
- Firestore Rules e Storage Rules publicadas.

Smoke:
- `/`, `/pricing`, `/teach`, `/account/payments`, `/courses` e `/verify` responderam 200 OK.

Observacoes:
- Firebase Hosting emitiu aviso de suporte Next.js em preview.
- Deploy SSR usou Node 24 e mostrou aviso de engine do `firebase-frameworks`, mas concluiu com sucesso.
- O projeto ainda nao tem Price IDs equivalentes no Stripe TEST para assinatura; LIVE esta validado.
