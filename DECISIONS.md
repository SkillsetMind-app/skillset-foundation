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

---

## D23 — Bunny rede **Volume**, e o custo real é banda, não armazenamento
**Data:** 2026-08-10 · **Decisão do fundador:** tier Volume ("bunny volume mesmo").

**Decisão:** Bunny Stream na rede **Volume** ($0.005/GB global).
**Alternativa descartada:** rede **Standard**, que na América do Sul custa $0.045/GB — **9×**.
**Por quê:** a Volume entrega dos mesmos PoPs para a maioria do tráfego; a Standard só se
justifica se latência de first-byte virar reclamação real de aluno. Não virou, e 9× não se
paga em hipótese.

### Conversão para a unidade que importa
1080p H.264 ≈ 3 Mbps ⇒ **1,32 GB por hora assistida**.

| Rede | $/GB | **$/hora assistida** |
|---|---|---|
| **Volume (escolhida)** | $0,005 | **≈ $0,0066** |
| Standard América do Sul | $0,045 | ≈ $0,059 |

### Armazenamento é ruído — a cota `videoStorageMinutes` não é o que custa
Ladder multi-rendição ≈1,8× o master ⇒ ≈0,040 GB/min. A $0,005/GB/mês:

| Plano | Cota | GB armazenados | **Custo/mês** |
|---|---|---|---|
| Free | 60 min | 2,4 | $0,01 |
| Starter | 600 min | 24 | $0,12 |
| Pro | 3.000 min | 120 | $0,60 |
| Plus | 10.000 min | 400 | $2,00 |

O plano mais caro custa **$2/mês** de armazenamento. Armazenamento não precisa de defesa.

### Banda é o que custa — e é a cota que NÃO existe
Receita = assinatura + comissão no GMV de referência do plano. Custo = horas × $0,0066.

| Plano | Receita/mês | Banda a 25% de conclusão | Banda a 100% | **Ponto de virada** |
|---|---|---|---|---|
| Free | 10% do GMV | $0,08 | $0,30 | irrelevante |
| Starter | ≈$38 | $4,50 | $18 | positivo mesmo a 100% |
| Pro | $194–419 | $150 | **$600** | **≈640 alunos** concluindo as 50 h |
| Plus | $419+ | — | **ilimitado** | **≈70.000 h/mês ≈ 420 alunos** concluindo as 167 h |

**Achado estrutural:** `activeStudents: null` no Plus, combinado com 167 h de catálogo e
**zero medição de banda no código**, é exposição sem teto. Pro tem o mesmo problema em
escala menor: permite 2.000 alunos, mas fica negativo acima de ~640 concluintes.

### O que NÃO foi feito, e o gatilho para fazer
**Não construí medidor de banda.** Hoje: Bunny não está conectado (modelo híbrido — YouTube
embed primeiro), 1 curso em produção, 0 criadores Plus. Medir agora é infraestrutura para
um problema que não existe.

**Construir quando qualquer um destes for verdade:**
1. Bunny servindo vídeo em produção **e** um criador passar de ~400 alunos ativos; ou
2. a fatura mensal da Bunny passar de ~$50.

**O que construir:** contador de GB servidos por professor (a própria Bunny expõe por
library/collection — não precisa ser instrumentado por nós) + o **overage suave** já
decidido: cobra o excedente, **nunca bloqueia vídeo em plano pago**. Aluno que pagou pelo
curso não pode bater em paywall de infraestrutura nossa.

---

## D24 — Afiliados saem do roadmap: são incompatíveis com *direct charge*
**Data:** 2026-08-20 · **Decisão do fundador:** *"a gente não tem afiliado — tire, porque não dá para ter agora perante o método de pagamento que temos."*

**Decisão:** rede de afiliados sai da lista de gaps competitivos e do roadmap. Não é "adiado por prioridade" — é incompatível com o modelo de pagamento atual.

**Por quê:** em *direct charge* o dinheiro nunca passa pela plataforma. A venda cai na conta Stripe conectada do professor, que é o merchant of record, e nós retiramos `application_fee_amount` no ato da cobrança. **Não existe saldo retido de onde pagar um terceiro.** Um programa de afiliados exigiria uma de duas coisas, e as duas são ruins hoje:

1. **Reter o dinheiro do professor** para repassar ao afiliado — quebra a Skillset Promise (*"você continua dono do seu dinheiro, sem hold da plataforma"*), que é o nosso argumento contra a Hotmart.
2. **Transferências saindo da conta conectada do professor** para a do afiliado, com autorização dele — dobra o escopo de compliance (KYC do afiliado, 1099/informe de rendimentos, chargeback em cadeia) por um recurso que nenhum criador do nicho pediu ainda.

**O que os concorrentes fazem:** Teachable, Thinkific, Kajabi e Skool têm afiliados no plano de entrada — mas os quatro são **merchant of record** ou seguram o dinheiro. O recurso é barato para eles exatamente porque o modelo de pagamento é o oposto do nosso.

**Consequência aceita:** perdemos uma linha na comparação lado a lado. A troca é deliberada — o direct charge é o que sustenta *"o dinheiro cai direto na sua conta"*, e esse argumento vale mais que a linha de afiliados.

**Gatilho para reabrir:** se e quando a plataforma passar a operar como merchant of record em alguma jurisdição, ou se três ou mais criadores pagantes pedirem explicitamente.

---

## D25 — Limitadores por plano: ancorar no número do concorrente, ganhar no preço
**Data:** 2026-08-20 · **Decisão do fundador:** *"devemos colocar limitadores, seja 1 curso ou 1 comunidade, algo equiparável ao nosso concorrente mas possivelmente melhor."*

**Decisão:** os planos passam a ter cotas reais. A regra de calibração é **entregar o mesmo número que o concorrente cobra caro, por menos dinheiro** — não inventar generosidade nem inventar escassez.

### Tabela decidida

| Cota | Free $0 | Starter $19 | Pro $89 | Plus $199 |
|---|---|---|---|---|
| Cursos publicados | 1 | 5 | 50 | ilimitado |
| Comunidades | 1 | 1 | 3 | ilimitado |
| Alunos ativos | 100 | 1.000 | 5.000 | ilimitado |
| Banda de vídeo/mês | 20 GB | 100 GB | 400 GB | 1.500 GB |
| **Armazenamento de vídeo** | **ilimitado** | ilimitado | ilimitado | ilimitado |
| Domínio próprio | 0 | 1 | 3 | 5 |
| Assentos de equipe | 1 | 2 | 6 | 15 |
| Destaques no marketplace | 0 | 1 | 3 | 5 |

### Ancoragem de cada número (preços lidos em 20/08/2026)

| Linha | Quem cobra o mesmo, e quanto |
|---|---|
| Free: 1 curso + 1 comunidade | Kajabi Starter, **$89/mês** |
| Free: 100 alunos | Teachable Starter, **$39/mês** |
| Starter: 5 cursos | Teachable Starter $39 · Kajabi Basic $179 |
| Starter: 1.000 alunos | Teachable Builder, **$89** |
| Pro: 50 cursos | Teachable Growth $189 · Kajabi Growth $249 |
| Pro: 3 comunidades | Thinkific Grow $219 · Kajabi Pro $499 |
| Pro: 5.000 alunos + 400 GB | Teachable Growth $189 · Thinkific Grow $219 |

### O que muda contra a tabela que está no código hoje

1. **Pro sobe de 25 → 50 cursos.** Estávamos abaixo de Teachable e Kajabi na mesma faixa.
2. **Alunos sobem de 50/300/2.000 → 100/1.000/5.000.** Estávamos abaixo do Teachable em **todos** os degraus, inclusive contra o plano de $39.
3. **Armazenamento vira ilimitado, inclusive no Free.** Ver justificativa abaixo.
4. **Comunidades e banda entram como cotas** — não existiam em `entitlements.ts`.
5. **Domínio próprio desce para o Starter** (era `0/0/1/3`, vira `0/1/3/5`).

### Por que armazenamento vira ilimitado e banda vira a cota real

Consequência direta do **D23**: armazenamento custa **$2/mês no plano mais caro**. Limitar storage é defender um custo que não existe, e nos deixa piores que o Teachable — que dá "até 1 TB" em todos os planos — numa linha onde podemos ganhar de todo mundo.

O custo real é **banda**: $0,0066 por hora assistida na rede Volume. É por isso que o mercado limita o que limita — Teachable raciona **aluno** (proxy de banda e suporte), Thinkific raciona **banda em GB** explicitamente. Ninguém raciona storage de verdade.

**"Armazenamento de vídeo ilimitado, inclusive no plano grátis"** passa a ser vitrine, com **cláusula de fair use no ToS** — o mesmo instrumento que Teachable e Kajabi já usam — e o tripwire anti-abuso interno já decidido no estudo de 14/07 (conta com muito armazenamento e zero venda em 90 dias entra em revisão de **novos uploads**, nunca da entrega a alunos).

### Free vale para sempre, não é degrau de trial
Decisão explícita do fundador. Quem estoura 100 alunos **já está vendendo** e sobe pelo teto de comissão (D26), não por bloqueio. O Free entregar o que a Kajabi cobra $89 é a arma competitiva — encurtá-lo destrói o argumento.

### Ressalvas registradas
- **A cota de banda só passa a valer quando a Bunny entrar em produção.** Hoje o modelo é híbrido com YouTube embed, custo zero. Até lá o número existe na tabela e não é cobrado.
- **O banco é o ponto de aplicação, não o TypeScript.** Hoje **6 das 7 cotas de `entitlements.ts` são decorativas** — só `featuredSlots` é conferido em SQL. Publicar esta tabela antes de as travas existirem no banco é vender limite que não se aplica; a implementação vem junto com a publicação, nunca antes.
- `entitlement_requests` (concessão de cota extra) ainda **não existe em nenhuma migração**. `effectiveLimit()` já aceita o parâmetro; falta a tabela e a tela de ops.

---

## D26 — Teto de comissão por plano
**Data:** 2026-08-20 · Proposto a partir da análise competitiva de 20/08; **pendente de aprovação do fundador.**

**Problema:** cobrar porcentagem ganha de mensalidade fixa em volume baixo e perde em volume alto, sempre. O **Teachable Builder — $89 fixo e 0% de comissão** — fica mais barato que qualquer plano nosso a partir de **$1.400/mês** de venda, e aos $10.000/mês custa $89 contra os nossos $389.

**Proposta:** a comissão para de subir a partir de um teto por plano.

| Plano | Hoje | Proposta | Efeito aos $10.000/mês |
|---|---|---|---|
| Starter $19 | 5% sem teto | 5% até **$60/mês** | $519 → **$79** |
| Pro $89 | 3% sem teto | 3% até **$120/mês** | $389 → **$209** |
| Plus $199 | 2% sem teto | 2% até **$200/mês** | $399 (já no teto) |

**Custo de implementar:** um campo por plano em `plans.ts` e um `Math.min` no cálculo da comissão — com a trava espelhada em SQL, como toda cota.

**Por que preserva o modelo:** o "$0 para começar" continua intacto, e o professor grande deixa de ter motivo aritmético para migrar. Vira argumento de venda: *"a sua taxa tem teto; a mensalidade deles não tem piso."*

**Fonte da análise:** `docs/benchmarks/2026-08-20-teachable-thinkific-kajabi-vs-skillset.md`
