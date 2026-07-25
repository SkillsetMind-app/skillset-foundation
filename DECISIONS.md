# DECISIONS — escolhas feitas sozinho

## 2026-05-25 - Fase 2 / Bloco B

> ⚠️ **SUPERSEDED por D21 (2026-06-06):** payout final reconciliado para **D+30** (decisão do fundador, Q1). O "10" abaixo é histórico, mantido por rastreabilidade.

**D16 - Payout release D+10.** A release automatica de payout agora usa 10
dias, mantendo a janela de auto-refund em 7 dias. Motivo: dar folga operacional
para atraso de webhook/refund antes de transferir dinheiro ao professor.

**D17 - Estimativa Stripe non-USD = 5.4% + fixo.** Mantive USD em
2.9% + $0.30 e mudei moedas nao-USD para 5.4% + $0.30 estimado
(cartao internacional 4.4% + conversao 1%). Motivo: previsao conservadora no
ledger; a taxa exata so fecha no saldo Stripe depois.

**D18 - Comissao canonica vem do plano do professor no servidor.** O servidor
ignora bps enviados pelo cliente e resolve a taxa pelo plano atual:
Free 1000 bps, Starter 500 bps, Pro 300 bps, Plus 200 bps (pivô 2026-07;
ladder original era 800/400/100/0). O pedido salva esse
snapshot para preservar historico de vendas.

**D19 - Refund depois de payout liberado reverte o transfer.** Se o ledger ja
esta `released`, o webhook `charge.refunded` cria uma reversal proporcional ao
valor reembolsado, com idempotency key. Motivo: nao deixar a plataforma carregar
o valor que ja foi transferido ao professor.

> Sessão autônoma 2026-05-19. Onde houve ambiguidade, escolhi a opção mais
> simples/conservadora. Você revisa e reverte se discordar.

## D1 — Taxa Stripe: heurística US vs internacional
**Decisão:** `currency === "USD"` ⇒ 2.9%+$0.30; qualquer outra moeda ⇒ 3.9%+$0.30.
**Alternativa descartada:** detectar país real do cartão (só conhecido após o pagamento, tarde demais pro cálculo do ledger).
**Por quê:** simples, determinístico no checkout, erra a favor da plataforma em borda.

## D2 — Sem application_fee_amount
> ⚠️ **SUPERSEDED pelo pivô de cobrança direta (2026-07-24)** — ver `docs/plans/2026-07-24-pivot-direct-charges.md` e D22 no fim deste arquivo.
> O modelo hoje é **direct charges**: a cobrança acontece na conta conectada do professor,
> ele é o **merchant of record**, e a comissão da plataforma é cobrada via
> `application_fee_amount` no momento da cobrança. Não existe mais
> `separate_charges_and_transfers`, não existe transfer da plataforma para o professor,
> e não existe retenção da plataforma (`payoutClearDays` foi removido) — o prazo de
> liquidação e de payout continua sendo o da Stripe, que não muda por nossa causa.
> Reembolso e chargeback perdido saem do saldo Stripe do professor, com
> `refund_application_fee: true` devolvendo a nossa taxa a ele. D19 (reversal de transfer
> no refund) e D21 (hold de 30 dias) caem junto. Mantido abaixo por rastreabilidade.

**Decisão:** manter `separate_charges_and_transfers`; taxa refletida reduzindo o transfer (`netAmountMinor`).
**Alternativa descartada:** migrar para destination charges com `application_fee_amount`.
**Por quê:** mudança de arquitetura de cobrança sem sua supervisão é arriscada. Funcionalmente equivalente para o resultado financeiro. Anotado para sua revisão.

## D3 — Hold de payout = 7 dias exatos
> ⚠️ **SUPERSEDED por D21 (2026-06-06):** o hold de payout é hoje **30 dias** (`payoutReleaseDelayDays = 30`). D3 (7) e D16 (10) foram valores intermediários; o número final é **30**. Mantido abaixo por rastreabilidade.

**Decisão:** `payoutReleaseDelayDays = 7`, igual à janela de reembolso.
**Alternativa descartada:** 7 + folga (ex.: 8-10) para garantir que o reembolso processou.
**Por quê:** você pediu explicitamente "logo após D+7". Conservador o suficiente; revisável numa linha.

## D4 — E-mail de verificação via Firebase nativo
**Decisão:** usar `sendEmailVerification` do Firebase Auth no fim do cadastro.
**Alternativa descartada:** Resend/SendGrid (exigiria sua API key — bloquearia P4).
**Por quê:** zero dependência externa, zero decisão sua, já temos Firebase. Template custom fica para depois (ver BLOCKERS B4).

## D5 — Bug da foto de perfil: corrigir defeitos comprováveis + tornar observável
**Contexto:** "foto não sobe / não aparece". Raciocínio profundo: o fluxo tem
**3 pontos que engoliam o erro** (`.catch(()=>undefined)` no mirror Auth, `catch {}`
vazio no painel mostrando "imagem muito grande" mesmo quando o problema é outro,
e `??` que não trata string vazia). Sem rodar como seu usuário (sem credencial),
não dá pra afirmar deterministicamente qual branch dispara (regra Firestore vs
dado legado de `username` inválido de signups antigos vs bucket env).
**Decisão:** corrigir os defeitos de código provados (logging com contexto,
mensagem de erro real, fallback de string vazia, null-guard de pathname) e
**tornar a causa observável** no seu próximo teste, em vez de "consertar no
escuro" e alegar resolvido sem verificação.
**Alternativa descartada:** mexer nas regras do Firestore por chute (poderia
enfraquecer segurança sem evidência).
**Por quê:** honestidade de engenharia — não afirmo "resolvido" sem verificar.
Ver BLOCKERS B6.

## D6 — Escopo da noite: P1 100% sólido > P2–P6 superficial
**Decisão:** entregar P1 completo com padrão de code review (testes, sem
gambiarra) e, para P2–P6, produzir `INSPIRATION_SPEC.md` (contrato de design
acionável) em vez de implementar UI de 140 telas às pressas.
**Alternativa descartada:** implementar parcialmente homepage/onboarding/
dashboards numa única sessão.
**Por quê:** suas próprias regras — "termina cada P o máximo que dá sozinho
antes de pular" e "Qualidade > velocidade. Sempre." UI meia-feita a partir de
imagens sem revisão seria a gambiarra que você proibiu. P2–P6 ficam
especificados e prontos para execução na próxima sessão.

## D7 — P2 home: âncoras só nas seções que existem; Pricing = rota real
**Decisão:** o header da home vira scroll-âncora para as seções que JÁ existem
(How it works, Capabilities, Promise, For creators). "Pricing" continua link
de rota real (`/pricing`) — exceção permitida pela spec.
**Alternativa descartada:** criar uma seção de preços na home.
**Por quê:** não existe seção de preço na home e a reforma anterior removeu
explicitamente conteúdo fabricado (princípio anti-fake, padrão #4). Criar uma
seria inventar conteúdo. `/pricing` já é página real com conteúdo real.
**Implementação:** `SiteNav` ganhou prop opcional tipada `landingNav` (união
discriminada âncora|rota). Só a home passa → demais páginas inalteradas (zero
regressão). Scroll suave nativo via CSS já guardado por prefers-reduced-motion.

## D8 — P4 e-mail: já existia; só removi o silenciamento
**Decisão:** não reconstruí P4 — `signUpWithEmail` já enviava verificação e
há UI de status/reenvio em `security-settings-panel` e `onboarding-choice`.
Só corrigi o `.catch(()=>undefined)` (padrão #3).
**Por quê:** regra #2b — reusar o que já funciona, não recriar.

## D9 — P3: redução agressiva do onboarding (80/20)
**Contexto:** o wizard real é `OnboardingWizard` (/welcome), já estilo Cakto
(1 pergunta/passo, progresso, persiste `onboardingAnswers`). `OnboardingChoice`
(/onboarding, 710 linhas) é outra rota com referência — NÃO deletado (regra #1).
**Decisão:** reduzir as perguntas visíveis de até 7 (professor) / 4 (aluno)
para **2 (aluno: path + primaryGoal)** e **3 (professor: + alreadySold)**.
Removidas do fluxo: sourceOfDiscovery, monthlyRevenue, instagramHandle,
audienceSize — mas mantidas no código (tipos/renderer), reativáveis numa
linha em `getVisibleQuestions`.
**Alternativa descartada:** manter 4–5 (spec original) — você disse
explicitamente "tem muita pergunta… mais reduzido". Fui mais agressivo
conscientemente; trivial reverter.
**Por quê / cuidado:** mantém o maior valor de analytics (objetivo +
intenção de monetização) com mínimo atrito. Bug evitado: `OnboardingProgress`
tinha default 7 dots; passei `totalQuestions={questions.length}` para o
indicador acompanhar o total real.

## D10 — P5/P6: corrigir o contrato da sidebar (não reconstruir dashboards)
**Contexto:** a reforma anterior já entregou sidebar colapsável
(`useSidebarState`, `SidebarToggle`, `PlatformNav collapsed`) e os painéis
têm `*-overview-metrics`. `.platform-sidebar` já era `position: sticky`.
**Decisão:** P5/P6 = corrigir o **gap real** do contrato "sidebar fixa, só
o conteúdo rola": faltava `align-self:start` (a linha do grid esticava) e
limite de altura — em telas baixas/menu longo a sidebar era cortada. Uma
mudança de CSS na shell compartilhada atende P5 **e** P6 de uma vez.
**Alternativa descartada:** reescrever os dashboards de professor/aluno a
partir das imagens. Seria recriar o que a reforma já fez (regra #2b) e
arriscar regressão sem revisão sua.
**Por quê:** maior valor / menor risco. Polimento de conteúdo específico de
cada dashboard (cards extras das telas Cakto) fica como trabalho futuro
opcional — a casca e o contrato de layout estão corretos.

## D11 — Perfil no topo-direito do dashboard = reusar AccountMenu
**Contexto:** `PlatformHeader` não renderizava perfil nenhum (só sino + CTA);
avatar só vivia na sidebar. Queixa exata do founder.
**Decisão:** renderizar o `AccountMenu` JÁ existente (usado no site público)
no header do dashboard, ao lado do CTA. Não reescrevi o menu.
**Alternativa descartada:** criar um novo dropdown do zero.
**Por quê:** regra #2b (reusar antes de criar); zero regressão no `SiteNav`.

## D12 — Stripe Connect é "just-in-time", não no signup (resposta à pesquisa)
**Decisão/achado:** o código já NÃO força Connect no signup/login — só
bloqueia no momento em que um aluno tenta comprar de um professor sem
payout configurado (`createCheckoutSession`). O atrito hoje é só de
*mensagem* (how-it-works diz "connect Stripe Express"). Recomendação:
manter Connect adiado e só pedir quando o professor for publicar curso
pago/sacar. Padrão Stripe recomendado (deferred onboarding).
**Planos (Free/Starter/Pro/Plus):** são Stripe **Billing** (assinatura),
SUBSYSTEM SEPARADO de Connect. Modelo recomendado: Checkout
`mode:'subscription'` + Customer Portal p/ upgrade/downgrade; o tier
define o `platformFeeBps` (canônico em `rules.ts`: 10/5/3/2%).
Connect (receber) e Billing (pagar o plano) coexistem independentes.
Implementação plena depende de Price IDs do painel Stripe + confirmação
do mapeamento tier→fee (ver BLOCKERS B7).

## D13 — Logo: troca por tema via CSS, variante "mark", tamanho maior
**Decisão:** 3 assets em `public/brand/` (mark agnóstico, full-light navy,
full-dark branco). `LogoWordmark` renderiza ambas as full e mostra a certa
por `[data-theme="dark"]` em CSS puro (sem JS → sem flash/hydration). Nova
prop `variant="mark"` para a bola; sidebar colapsada usa a bola (não o "S").
Altura nav 20→32px (compact 40, default 48) — você disse "muito pequeno".
**Alternativa descartada:** trocar logo por hook de tema em JS (flash no
SSR) / um único arquivo (não cobre dark/light).
**Por quê:** CSS theme-swap é o padrão SSR-safe; reusa `LogoWordmark`
(regra #2b); `LinkLogo` mantido (sem deletar referência — regra #1), só
passou a renderizar a bola. Removido só o import `Link` que EU orfanei.

<!-- novas decisões anexadas conforme a sessão avança -->
# D14 - Bloco A: upload so para aulas persistidas
**Decisao:** uma aula criada localmente no Builder nao pode receber video/material
ate o draft ser salvo e a aula existir no Firestore.
**Por que:** `course-assets.ts` grava arquivos imediatamente no Storage e cria
metadata em `courses/{courseId}/assets`. Permitir upload para um lessonId ainda
nao persistido poderia gerar asset orfao se o professor saisse sem salvar.
**Tradeoff:** exige um clique em "Save draft" antes do upload da aula nova.
E a opcao mais conservadora para integridade de dados no MVP.

# D15 - Bloco A: separar progresso do wizard e readiness de revisao
**Decisao:** a barra lateral do Builder agora usa o progresso da etapa atual
(`Builder step X of 4`) e mostra readiness como texto separado.
**Por que:** readiness e etapa atual sao estados diferentes. Misturar os dois
gerava a percepcao de bug tipo "Step 1 ... 71%".

# D20 - Stripe LIVE como ambiente de producao atual
**Decisao:** manter producao apontando para Stripe LIVE, porque `.env.local` e
`.env.production` ja usam `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` live e os 6 Price
IDs configurados no servidor existem no Stripe LIVE.
**Tradeoff:** Stripe TEST ainda nao tem Price IDs equivalentes para planos.
Teste completo de assinatura em staging exige criar produtos/precos TEST
separados antes de alternar um ambiente nao-producao para TEST.

# D21 - Payout reconciliado em 30 dias (2026-06-06, decisão final do fundador)
**Decisão:** `payoutReleaseDelayDays = 30` é o número canônico e final. Supersede
D3 (7 dias) e D16 (D+10), que foram valores intermediários. Reembolso permanece em
7 dias (`refundWindowDays = 7` no FE / `automaticRefundWindowDays = 7` no BE).
**Por quê:** o motor já roda 30 em produção (`functions/src/payment-rules.ts:12`) e
toda a copy de UI (capabilities-grid, how-it-works-strip, teacher-wallet-panel, help,
trust, pricing, fees-and-payouts, for-creators, account/plans) já deriva de
`payoutClearDays = 30` (`src/data/plans.ts:196`). 30 > 7 garante que um payout liberado
nunca antecede uma cobrança ainda reembolsável, com folga para atraso de webhook.
**Single source of truth:** BE `payoutReleaseDelayDays=30` + FE `payoutClearDays=30`.
**Ação deste T1 (2026-06-06):** docs/comentários que ainda diziam 7/10 foram anotados
como SUPERSEDED ou corrigidos para 30 (DECISIONS D3/D16, roadmap, demo-readiness,
HANDOFF, TEST_RESULTS, benchmark Cakto, comentário em `index.ts`). A UI já estava
correta — a auditoria que alegava "UI diz 7 dias" estava desatualizada.

# D22 - Pivô para direct charges: a plataforma sai do caminho do dinheiro (2026-07-24)
**Decisão:** o Checkout Session é criado **na conta conectada do professor**
(`{ stripeAccount: connectedAccountId }`) e a comissão da plataforma é cobrada com
`application_fee_amount` no instante da cobrança. O professor é o **merchant of record**.
A SkillsetMind nunca custodia, nunca repassa e nunca libera dinheiro de criador.
**Alternativa descartada:** manter destination charges / `separate_charges_and_transfers`
com transfer da plataforma para o professor (D2, D19, D21).
**Por quê:** a custódia era o risco estrutural do produto — obrigava retenção
(`payoutClearDays = 30`), transfer reversal no reembolso, e colocava a plataforma como
parte financeira em toda disputa. Com direct charges o dinheiro nunca é nosso, então não
há o que reter: `payoutClearDays` foi removido do código.
**Consequências:**
- Supersede D2, D19 e D21. D3 e D16 já eram históricos.
- Reembolso é criado na conta conectada, com `refund_application_fee: true` — sai do saldo
  Stripe do professor e devolve a nossa taxa a ele. Chargeback perdido idem.
- O descritor que chega na fatura do comprador é o **do professor**, não o nosso (não
  setamos `statement_descriptor`). Por isso as telas de compra, confirmação, recibos e
  reembolso passaram a dizer explicitamente quem é o vendedor — sem isso o comprador não
  reconhece a linha no extrato e abre disputa contra o professor.
- Afiliados e coprodutores foram **removidos**, não adiados: uma plataforma que nunca toca
  no dinheiro não tem como rateá-lo.
**O que NÃO mudou (e a copy não pode alegar que mudou):** o prazo da Stripe. A liquidação
(`available_on`) e o payout continuam sendo da Stripe — 2 dias úteis nos EUA, **30 dias
corridos no Brasil para cartão doméstico** — mais o período de espera do primeiro payout.
Nós zeramos a retenção **da plataforma**, e só isso. Nenhuma copy pode dizer "na hora",
"imediato", "D+0", "sem período de compensação" (sem qualificar) nem alegar ser mais
rápida que ninguém. Como criamos contas **Express**, também não podemos dizer que o
professor "controla" o cronograma de payout — só que ele é **dele**, no dashboard dele.
**Plano completo:** `docs/plans/2026-07-24-pivot-direct-charges.md`.
