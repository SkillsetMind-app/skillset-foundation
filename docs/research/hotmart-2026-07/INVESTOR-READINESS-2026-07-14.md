# SkillsetMind — Investor Readiness Assessment (Olhar de CEO/Investidor)

> **Data:** 2026-07-14
> **Pergunta do founder:** "Se eu fosse num Shark Tank / apresentar para investidores, o que eles avaliariam? O que já temos? O que falta?"
> **Insumos:** doc-norte (`CONTEXTO-PRODUTO-BACKLOG-2026-07-11.md`), código em produção (skillsetmind.com), pesquisa de mercado 2026.

---

## 0. Veredito executivo (a resposta curta)

**A plataforma está à frente do normal em PRODUTO e atrás do normal em TRAÇÃO — e investidor early-stage compra tração, não produto.**

Um painel tipo Shark Tank diria hoje: *"Produto impressionante para um founder solo. Quantas vendas? Zero? Volte quando tiver as primeiras."* Isso não é um problema de documentação — é o único gap que dinheiro nenhum de investidor resolve antes de existir: **prova de que criadores escolhem a plataforma e alunos pagam nela**.

A boa notícia: o custo de construção (founder solo + IA) é em si um argumento de investimento raríssimo — *capital efficiency* extrema. A história "construí um concorrente de Hotmart funcional, com pagamentos reais no ar, por uma fração de 1% do que custaria com um time" é exatamente o tipo de narrativa que investidor de 2026 quer ouvir, **desde que acompanhada de tração inicial**.

**Prioridade nº 1 não é preparar data room. É colocar 10–15 criadores fundadores vendendo.** O data room se monta em 2–3 sessões de trabalho; a tração leva 60–90 dias. Comece pela tração e monte o data room em paralelo.

---

## 1. O que um investidor avalia (as 9 lentes do Shark Tank / seed VC)

| # | Lente | Pergunta que o investidor faz | Peso no estágio atual |
|---|-------|-------------------------------|----------------------|
| 1 | **Founder/time** | Quem é você, por que VOCÊ ganha esse mercado, com que velocidade executa? | ★★★★★ |
| 2 | **Problema + mercado** | A dor é real e grande? Qual o TAM/SAM/SOM? | ★★★★ |
| 3 | **Produto** | Existe? Funciona? Posso ver uma demo ao vivo? | ★★★ |
| 4 | **Tração** | Alguém usa? Alguém PAGA? Cresce mês a mês? | ★★★★★ |
| 5 | **Unit economics** | De cada R$ transacionado, quanto sobra? CAC < LTV? | ★★★★ |
| 6 | **Defensibilidade (moat)** | Por que Hotmart/Kiwify não te esmaga? O que segura o criador aqui? | ★★★★ |
| 7 | **Go-to-market** | Como você adquire criadores de forma repetível e barata? | ★★★★ |
| 8 | **Deal/jurídico** | Entidade limpa? Cap table simples? Em que estou investindo exatamente? | ★★★ |
| 9 | **Data room** | Os documentos e números existem e batem entre si? | ★★ (higiene, não decide) |

Benchmarks de mercado 2026 que calibram essas lentes:

- **Mercado:** creator economy global ≈ US$ 260–310 bi em 2026, crescendo ~22–23% a.a.; a fatia de educação/cursos online ≈ 10% (~US$ 26 bi) ([New Market Pitch](https://newmarketpitch.com/blogs/news/creator-economy-market-size), [Grand View Research](https://www.grandviewresearch.com/industry-analysis/creator-economy-market-report)).
- **Comparáveis:** Kajabi — US$ 550M levantados, valuation US$ 2 bi ao atingir US$ 100M ARR; US$ 10 bi já pagos a criadores ([Sacra](https://sacra.com/c/kajabi/), [Contrary Research](https://research.contrary.com/company/kajabi)). Hotmart comprou a Teachable por US$ 250M em 2020 ([Tracxn](https://tracxn.com/d/companies/kajabi/__nd-cfJdZhf0lcGZqPQPEsLnEil4JoLAcxdueK1hNa1w)).
- **Régua seed 2026:** sinais iniciais de product-market fit (US$ 50–200K ARR ou retenção forte) já sustentam seed de US$ 3–4M a ~US$ 15M post-money ([Flowjam/Carta](https://www.flowjam.com/blog/seed-round-valuation-2025-complete-founders-guide)).
- **Régua Série A marketplace:** GMV mensal US$ 500K–2M, crescimento 15–20% m/m, retenção de GMV 80%+, LTV:CAC 3:1+ ([Qubit Capital](https://qubit.capital/blog/preparing-for-series-a-funding-marketplace-startups), [Everything Marketplaces](https://www.everythingmarketplaces.com/post/fundraising-guide-benchmarks-for-marketplaces-in-2026)).
- **O que VCs olham em marketplace:** crescimento de GMV, GMV por criador/comprador, concentração, take rate e margem de contribuição; transações reais + velocidade valem mais que GMV absoluto no seed ([CRV](https://www.crv.com/content/gmv-meaning), [The VC Corner](https://www.thevccorner.com/p/key-startup-metrics-vcs)).

---

## 2. Scorecard: o que a SkillsetMind JÁ TEM (por lente)

### Lente 1 — Founder/time: **forte, com uma lacuna narrativa**
- ✅ Founder solo que colocou no ar uma plataforma completa de pagamentos com alavancagem de IA — velocidade de execução demonstrável (histórico git é prova).
- ✅ Burn próximo de zero: infraestrutura em free tiers, sem folha de pagamento. Runway efetivamente infinito enquanto pré-receita.
- ⚠️ Falta empacotar isso em narrativa: "quanto custou construir vs. quanto custaria" é um slide matador que ainda não existe.

### Lente 2 — Problema + mercado: **forte no diagnóstico, sem números próprios**
- ✅ Dor validada por pesquisa (doc-norte): bloqueio de saldo 30–90 dias em plataformas dominantes é a maior dor do criador BR; suporte ruim; taxas opacas.
- ✅ Nicho definido: psicólogos, terapeutas e profissionais de desenvolvimento pessoal — segmento com necessidade específica (credibilidade/selos) que plataformas generalistas não atendem.
- ❌ Sem TAM/SAM/SOM formalizado com números próprios (ex.: nº de psicólogos ativos no CFP ~480 mil registros, % que produz conteúdo digital, ticket médio).

### Lente 3 — Produto: **acima da média para o estágio**
- ✅ Em produção: skillsetmind.com (Vercel + Supabase), demo ao vivo possível a qualquer momento.
- ✅ Motor financeiro completo e raro em MVP: Stripe LIVE, split de pagamento, 4 planos (Free 8% / Starter $19+4% / Pro $89+1% / Plus $199+0%), janela de reembolso 7d, clearing de repasse 30d, tratamento de clawback/recompra/chargeback, snapshot de plano por venda.
- ✅ Certificados verificáveis ("SkillsetMind Verified" com código público de verificação) — semente do moat.
- ✅ Qualidade de engenharia auditável: 160 testes automatizados verdes, CI, decisões documentadas (DECISIONS.md).
- ⚠️ Backlog P1 (credenciamento/catálogo/selos) ainda não implementado — é justamente o diferencial competitivo prometido.

### Lente 4 — Tração: **zero. É O gap.**
- ❌ 0 criadores onboardados, 0 alunos, R$ 0 de GMV, R$ 0 de receita.
- ❌ Sem lista de espera, sem cartas de intenção, sem piloto.
- Este item sozinho encerra qualquer conversa de investimento hoje. Tudo o mais é secundário.

### Lente 5 — Unit economics: **modelo definido, sem dados reais**
- ✅ Estrutura de receita dupla já codificada (comissão + assinatura), com break-evens calculados: Free→Starter em $475 GMV/mês, Starter→Pro em $2.333, Pro→Plus em $11.000.
- ✅ Taxa Stripe repassada ao criador (protege margem — decisão D2 documentada).
- ✅ Cenário ilustrativo defensável: 100 criadores × $500 GMV/mês = $50K GMV → ~$4K/mês só de comissão Free (8%) + assinaturas. Take rate blended estimado 4–6% (entre Udemy ~50% e Kajabi ~0% + SaaS).
- ❌ CAC desconhecido (nunca houve aquisição paga), LTV desconhecido, churn desconhecido.

### Lente 6 — Moat: **desenhado, não construído**
- ✅ Skillset Promise (anti-bloqueio de saldo) — posicionamento direto contra a maior dor do mercado BR; nenhum grande player pode copiar sem canibalizar seu próprio modelo de retenção de caixa.
- ✅ Selos de credenciamento profissional (CRP/CFP para psicólogos) — confiança verticalizada que Hotmart/Kiwify não têm.
- ⚠️ Selos ainda no backlog (P1). Promise publicada mas sem histórico que a prove.
- ❌ Efeito de rede ainda inexistente (precisa de liquidez: criadores ↔ alunos).

### Lente 7 — Go-to-market: **a segunda maior lacuna**
- ⚠️ Estratégia esboçada (nicho psicólogos, founding creators) mas sem playbook de aquisição testado, sem canal comprovado, sem custo por criador adquirido.
- ✅ Ativo não-óbvio: o próprio founder domina prospecção outbound (experiência PS8) — o motor de aquisição dos primeiros 15 criadores pode ser manual e a custo ~zero.

### Lente 8 — Deal/jurídico: **indefinido**
- ⚠️ Entidade legal: "Skillset USA" aparece como entidade nos termos, mas estrutura societária, país de incorporação e cap table precisam ser formalizados/confirmados antes de qualquer conversa.
- ✅ Cap table presumivelmente trivial (founder solo, sem investidores anteriores, sem dívida conversível) — isso é um PONTO FORTE: deal limpo.
- ⚠️ Compliance: postura LGPD definida na pesquisa (diretório 1:1 sem dados clínicos), mas sem documento formal de privacidade/tratamento de dados para due diligence.

### Lente 9 — Data room: **~30% pronto, o resto é gerável rápido**
- ✅ Já existe: doc-norte de produto, DECISIONS.md, pesquisa competitiva (7 deltas), código testado e documentado, histórico git.
- ❌ Falta: pitch deck, one-pager, modelo financeiro, TAM/SAM/SOM, docs societários, dashboard de métricas.

**Placar geral: 5 lentes fortes ou encaminhadas, 2 críticas (tração, GTM), 2 de higiene (deal, data room).**

---

## 3. Checklist de lacunas — priorizado

### 🔴 P0 — Sem isso, não há conversa (60–90 dias, só o mercado resolve)

| # | Lacuna | Ação concreta | Quem |
|---|--------|---------------|------|
| 1 | **Tração zero** | Recrutar 10–15 criadores fundadores (psicólogos/terapeutas) via outbound manual. Meta: primeiro GMV real em 30 dias, R$ 5–20K GMV/mês em 90 dias | Patrick (vendas) + eu (materiais, onboarding, ferramentas) |
| 2 | **Métricas não instrumentadas** | Dashboard de KPIs: GMV, take rate efetivo, criadores ativos, alunos, conversão visita→compra, retenção. Base: dados do Supabase + Vercel Analytics | Eu (1 sessão) |
| 3 | **P1 do doc-norte (selos/credenciamento)** | É o moat prometido ao nicho — sem ele, o pitch "plataforma para psicólogos" não se diferencia | Eu (3–5 sessões, já planejado) |

### 🟡 P1 — Data room mínimo (paralelo ao P0, ~3 sessões de trabalho)

| # | Lacuna | Entregável |
|---|--------|-----------|
| 4 | Narrativa de mercado | TAM/SAM/SOM com fontes: creator economy US$ 260bi+ → educação ~US$ 26bi → BR + nicho psicólogos (CFP: ~480 mil registros ativos como proxy) |
| 5 | One-pager | 1 página: problema, solução, mercado, modelo de receita, diferencial, ask |
| 6 | Pitch deck | 10–12 slides padrão seed (problema → solução → demo → mercado → modelo → moat → tração → time → projeções → ask) |
| 7 | Modelo financeiro | Planilha 24 meses com os números reais de `plans.ts` (comissões 8/4/1/0%, assinaturas, break-evens) em 3 cenários |
| 8 | Slide de capital efficiency | "O que foi construído vs. o que custaria": motor de pagamentos + certificados + 160 testes, founder solo + IA |
| 9 | Formalização societária | Confirmar/estruturar entidade (Skillset USA? LTDA BR? Delaware C-Corp se alvo for VC americano), cap table de 1 linha |

### 🟢 P2 — Fortalece a tese (após primeiras vendas)

| # | Lacuna | Entregável |
|---|--------|-----------|
| 10 | Prova social | 3–5 depoimentos de criadores fundadores + estudo de caso ("criador X recebeu em D+30 vs D+90 na plataforma anterior") |
| 11 | Métricas de coorte | Retenção de GMV por coorte de criador, NPS, tempo médio de repasse cumprido (prova da Promise) |
| 12 | Compliance pack | Política de privacidade formal, mapa de dados LGPD, termos revisados por advogado |
| 13 | Advisors | 1–2 nomes do nicho (psicologia/edtech) como conselheiros — barato em equity, alto em credibilidade |
| 14 | Projeções auditáveis | Atualizar modelo financeiro com CAC/LTV/churn REAIS medidos nos primeiros 90 dias |

---

## 4. O desafio de premissa (o que um CEO experiente diria)

**"Você precisa mesmo de investidor?"** Com burn ~zero e capacidade de construir com IA, a SkillsetMind pode chegar a R$ 30–50K GMV/mês sem capital externo. Nesse ponto, a conversa com investidor inverte: você negocia de posição de força (valuation melhor, menos diluição) ou descobre que não precisa deles. **Investor-readiness aqui é OPCIONALIDADE, não necessidade** — e essa é a melhor posição possível.

**A ordem certa das peças:**
1. **Agora → 90 dias:** tração (P0) + data room mínimo (P1) em paralelo.
2. **90 dias:** com GMV real + deck pronto, decidir: (a) bootstrap até break-even, (b) anjo/aceleradora BR (cheques R$ 200K–1M), ou (c) seed US (exige Delaware C-Corp).
3. **A régua a bater para seed formal:** US$ 50K+ ARR equivalente ou crescimento 15%+ m/m por 4+ meses consecutivos.

---

## 5. Próximas ações sugeridas (em ordem)

1. **Eu executo (não bloqueia em ninguém):** dashboard de KPIs (#2) → P1 selos/credenciamento (#3) → one-pager + modelo financeiro (#5, #7).
2. **Patrick decide/executa:** definir a oferta para criadores fundadores (ex.: plano Pro grátis por 12 meses + repasse D+30 garantido) e começar o outbound para os primeiros 15.
3. **Patrick resolve (jurídico):** confirmar a entidade legal e a estrutura societária (#9) — pré-requisito para QUALQUER cheque.

---

## Fontes

- [Grand View Research — Creator Economy Market Report](https://www.grandviewresearch.com/industry-analysis/creator-economy-market-report)
- [New Market Pitch — Creator Economy Market Size 2026](https://newmarketpitch.com/blogs/news/creator-economy-market-size)
- [Sacra — Kajabi valuation & funding](https://sacra.com/c/kajabi/)
- [Contrary Research — Kajabi Business Breakdown](https://research.contrary.com/company/kajabi)
- [Tracxn — Kajabi Company Profile](https://tracxn.com/d/companies/kajabi/__nd-cfJdZhf0lcGZqPQPEsLnEil4JoLAcxdueK1hNa1w)
- [CRV — GMV: What VCs Actually Look For in Marketplaces](https://www.crv.com/content/gmv-meaning)
- [Qubit Capital — Preparing for Series A in Marketplace Startups](https://qubit.capital/blog/preparing-for-series-a-funding-marketplace-startups)
- [Everything Marketplaces — Fundraising Guide & Benchmarks 2026](https://www.everythingmarketplaces.com/post/fundraising-guide-benchmarks-for-marketplaces-in-2026)
- [Flowjam — Seed Round Valuation 2026 (Carta data)](https://www.flowjam.com/blog/seed-round-valuation-2025-complete-founders-guide)
- [The VC Corner — Key Startup Metrics VCs Care About](https://www.thevccorner.com/p/key-startup-metrics-vcs)
