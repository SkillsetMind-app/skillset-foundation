# SkillsetMind — Estudo de Custos & Estrutura de Planos
> **Data:** 2026-07-14 · **Gatilho:** Patrick identificou que os planos estavam "crus" — definidos sem modelo de custo por trás do "tudo ilimitado".
> **Complementa:** `CONTEXTO-PRODUTO-BACKLOG-2026-07-11.md` (doc-norte) e a arquitetura de lançamento (Founding Pass + Founding Builder).

---

## 1. O diagnóstico: por que os planos dos concorrentes são assim

**Os limites dos concorrentes não são "planos" — são controle de custo disfarçado de plano.**

| Plataforma | Modelo de receita | O limite que impõem | O custo real que ele protege |
|---|---|---|---|
| Kajabi ($179–499/mês) | SaaS (assinatura) | 2.500 → 25.000 → 100.000 **contatos** | E-mail marketing: cada contato = custo de envio/deliverability |
| Kajabi | SaaS | 5 → 50 → ∞ **produtos** | Hosting de vídeo/conteúdo por produto |
| Teachable ($29–189/mês) | SaaS híbrido | 100 → 1.000 → 5.000 **alunos** + 7,5% no plano de entrada | Bandwidth de vídeo + suporte por aluno |
| Thinkific ($36–149/mês) | SaaS | Aulas ao vivo, HTML/CSS por tier | Infra de live streaming + suporte técnico |
| Hotmart (R$0/mês + 9,9%+R$1) | **Marketplace (take rate)** | R$2,49/venda pelo **player de vídeo** + 3,49%/mês de parcelamento | Entrega de vídeo (CDN) + risco de crédito do parcelamento |

**Insight central:** Kajabi/Teachable/Thinkific vendem SOFTWARE (assinatura paga a infra; limites forçam upgrade). Hotmart vende TRANSAÇÃO (take rate paga a infra; as "taxinhas" cobrem exatamente os recursos cujo custo escala com o uso). **Nós somos o modelo Hotmart** — logo nosso controle de custo deve ser no estilo marketplace (quotas de uso nos recursos caros), não no estilo SaaS (limite de contatos que nem faz sentido pra nós, já que não temos e-mail marketing).

---

## 2. Nossos custos reais, recurso por recurso

Fontes: preços públicos jul/2026 — [Bunny Stream](https://bunny.net/pricing/stream/), [Supabase](https://supabase.com/pricing). Stack: doc-norte §2.

### 2.1 Custo FIXO (independe de quantos creators)

| Item | Custo/mês | Nota |
|---|---|---|
| Supabase Pro (obrigatório pré-launch) | US$25 | Inclui 8GB DB, 250GB egress, 100GB file storage, backups 7d |
| Vercel Pro | US$20 | (Hobby US$0 serve até tração) |
| Bunny (mínimo) | US$1 | Mínimo de conta + uso |
| Resend/e-mail transacional | US$0–20 | 3k e-mails/mês grátis; US$20 = 50k/mês |
| n8n (VPS Contabo já existente, compartilhado) | ~US$0 marginal | Já pago por outros projetos |
| PostHog | US$0 | Free tier generoso |
| **PISO FIXO TOTAL** | **~US$50–70/mês** | Com 8% de take, **US$625–875 de GMV/mês paga toda a infra** |

### 2.2 Custo VARIÁVEL (escala com uso — os únicos 2 que importam)

**A) Vídeo hospedado (Bunny Stream) — o custo dominante**

- Armazenamento: **US$0,01/GB/mês** (2 regiões) · Entrega: **US$0,005–0,01/GB** · Transcoding, player, DRM: **incluídos**
- Curso de 10h em 1080p ≈ 30–40GB armazenado (original + renditions) → **~US$0,30–0,40/mês por curso**
- Aluno que assiste o curso inteiro ≈ 20GB entregues → **~US$0,10–0,25 por aluno**

Contra a nossa receita:
| Cenário | Nossa receita/venda | Custo de vídeo/aluno | % da nossa receita |
|---|---|---|---|
| Curso US$100, plano Free (8%) | US$8,00 | US$0,10–0,25 | 1–3% ✅ |
| Curso US$100, Founding (2%) | US$2,00 | US$0,10–0,25 | 5–12% ⚠️ |
| Curso via **YouTube embed** | qualquer | **US$0,00** | 0% ✅ |

⚠️ O cenário de risco NÃO é o creator que vende (custo ≤3% do take). É o **creator morto**: sobe 40GB de vídeo, nunca vende nada. 1 creator morto = US$0,40/mês (irrelevante). **1.000 creators mortos = 40TB = ~US$400/mês** (relevante). → Por isso quota de storage, não taxa por venda.

**B) IA (DeepSeek via n8n): help assistant + teach advisor + painel do professor)**

- DeepSeek ≈ US$0,27/1M tokens input, US$1,10/1M output
- Usuário pesado (100 msgs/dia, mês inteiro) ≈ US$2–5/mês. Usuário normal: centavos.
- Risco não é margem, é **abuso sem limite** (bot martelando o endpoint). → Solução: rate limit por conta/dia, não cobrança.

### 2.3 Custo ZERO ou repassado (não precisam de controle)

| Recurso | Por quê custa ~zero pra nós |
|---|---|
| YouTube embed (modelo híbrido já decidido) | Google paga a CDN |
| Taxa Stripe | Já repassada ao creator (DECISIONS D2) |
| Comunidade/área de membros (texto) | Postgres — negligível |
| Certificados, selos, catálogo | Storage de texto/HTML |
| 1:1 Fase 2 Opção B (agendamento + link externo) | Vídeo roda fora |
| E-mail transacional | Volume baixo, free tier cobre |

**Conclusão da seção:** nossa margem estrutural é saudável. No plano Free (8%), o custo marginal por venda é **1–3% do nosso take**. Não precisamos de "taxinhas" estilo Hotmart — precisamos de exatamente **2 alavancas**: quota de vídeo hospedado e rate limit de IA.

---

## 3. As alavancas de controle (nosso equivalente às "taxinhas" — sem trair o posicionamento)

Posicionamento é "o oposto das plataformas extrativas" → multiplicar taxinhas opacas (o modelo Hotmart) seria suicídio de marca. Em vez disso:

1. **Quota de vídeo hospedado por plano** (estilo Kajabi limita produtos): Free = 20GB (~1 curso de 10h) · pago = mais. YouTube embed ilimitado em TODOS os planos (válvula de escape gratuita).
2. **Excedente a preço de custo, publicado**: passou da quota, paga o custo real de infra (~US$0,02/GB/mês, margem mínima), tabela pública. Vira ARGUMENTO DE MARKETING: *"A Hotmart cobra R$2,49 por venda pelo player. Nós publicamos nosso custo real e repassamos sem margem escondida."*
3. **Rate limit de IA por plano**: Free = 20 msgs/dia · pago = mais · anti-abuso, não paywall.
4. **Taxa Stripe repassada** (já existe, manter).

**Compatibilidade com a Skillset Promise ("paridade de features"):** quota ≠ feature lock. Todos os planos têm TODAS as features (upload, IA, comunidade, certificados). O que varia é VOLUME dos 2 recursos que custam dinheiro — mesmo padrão do Kajabi (5 vs 50 produtos), com transparência que ele não tem. A Promise permanece intacta.

---

## 4. Gap de features — eles têm / nós temos (honesto)

### Eles têm, nós NÃO temos (ainda)

| Feature | Quem tem | Custo de construir/operar | Precisamos no launch? |
|---|---|---|---|
| E-mail marketing / campanhas | Kajabi (core), Hotmart | ALTO (deliverability, IPs, compliance) | **NÃO** — founding creators trazem a própria audiência (GTM doc-norte §6) |
| Automações creator-facing | Kajabi Growth | MÉDIO (UI de workflows) | NÃO — roadmap pós-GMV |
| Site builder (1–3 sites) | Kajabi | ALTO | NÃO — página pública de creator + landing de curso cobrem; templates CFP-safe (§3.5) são a nossa versão diferenciada |
| Carrinho abandonado | Thinkific/Teachable | **BAIXO** (e-mail transacional + cron) | Não bloqueia — item barato de roadmap pós-launch (P2/P3) |
| Rede de afiliados | Hotmart (global), Kajabi Growth | MÉDIO | NÃO — a Fase 3 "plataforma-como-afiliado" (50%) é a nossa versão, já registrada |
| Aulas ao vivo | Thinkific Start | — | NÃO — link externo resolve (mesma lógica da Fase 2 Opção B) |
| Checkout com impostos internacionais automáticos | Hotmart | — | Parcial: Stripe Tax existe como upgrade futuro |

### Nós temos, eles NÃO têm (as respostas pra "por que a sua plataforma?")

| Diferencial | Quem mais tem? |
|---|---|
| **Selos de verificação de credencial** (CRP/license/CNPJ automático) | NINGUÉM. Hotmart/Kajabi aceitam qualquer um — e a dor nº 1 documentada do nosso público é ser confundido com charlatão |
| **Templates + validador CFP-safe** (publicidade em conformidade ética) | NINGUÉM |
| **Skillset Promise**: fee-lock 24m, export ZIP 1-clique, dono da audiência/dados/contrato | Ninguém empacota isso como contrato de produto |
| **US$0/mês + 8%** vs Hotmart 9,9%+R$1 (mais barato em QUALQUER ticket) vs Kajabi piso US$179/mês | Estruturalmente mais barato |
| Founding: 2% vitalício / trava de 6% | Inédito no nicho |
| AI advisor de nicho (teach advisor) + help RAG | Kajabi tem IA genérica de conteúdo; a nossa é específica do nicho terapêutico |
| Catálogo do nicho (Constelação, Hipnoterapia, Supervisão…) | Nas gerais, essas categorias nem existem |
| Wallet multi-moeda (30+) com ledger + proteção de fundos | Hotmart tem parcial; Kajabi não é marketplace |

**O pitch de uma frase:** *"As plataformas genéricas te dão mais ferramentas de marketing; nós te damos a menor taxa do mercado, um selo que prova que você não é charlatão, divulgação que não viola o CFP — e você continua dono da sua audiência. As ferramentas extras chegam pelo roadmap, financiadas pelo GMV, com sua taxa travada."*

A fraqueza (menos ferramentas de marketing) é neutralizada pelo GTM: no launch, os founding creators trazem audiência própria — e-mail marketing deles já existe fora. Competimos em **taxa + confiança + nicho**, não em amplitude de ferramentas v1.

---

## 5. Estrutura de planos REVISADA (dormente — reativa pós-launch com dados reais)

| | **Free** | **Creator** ~US$39/mês | **Pro** ~US$99/mês |
|---|---|---|---|
| Comissão | 8% | 3% | 1% |
| Vídeo hospedado (Bunny) | 20GB (~1 curso 10h) | 100GB | 500GB |
| YouTube embed | ∞ | ∞ | ∞ |
| Excedente de vídeo | ao custo publicado | ao custo | ao custo |
| IA (advisor + help) | 20 msgs/dia | 100/dia | fair use ∞ |
| Suporte | e-mail 48h | 24h | prioritário |
| Features da plataforma | **TODAS** | **TODAS** | **TODAS** |
| Break-even p/ upgrade (GMV/mês) | — | ~US$780 | ~US$3.000 |

- 3 planos (não 2): Free = porta de entrada eterna (modelo Hotmart); Creator = 1º upgrade natural; Pro = creator estabelecido. Os 4 tiers atuais do `plans.ts` (Free/Starter/Pro/Plus) simplificam para 3 na reativação.
- Founding Creator (US$497): 0% 3 meses → 2% vitalício + quotas do Pro + beta access + selo.
- Founding Builder (mérito): 6% vitalício + quotas do Creator + selo.
- **Preços/quotas finais só na reativação, com dados reais de GMV e uso** — este desenho é a espinha, não o número travado.

## 6. Impacto no escopo de código do lançamento

| Item | Quando | Esforço |
|---|---|---|
| Soft cap de storage por creator (ex.: 50GB no launch gratuito) — check no upload | **LAUNCH** (única adição) | ~1h — previne o cenário "creator morto" desde o dia 1 |
| Rate limit IA por conta/dia | LAUNCH (junto do painel IA) | pequeno |
| Enforcement de quotas por plano | Reativação dos planos (pós-launch) | médio |
| Simplificação 4→3 tiers no `plans.ts` + Stripe prices | Reativação | pequeno |
| Carrinho abandonado (e-mail transacional) | Roadmap P3 | pequeno |
| Tabela pública de custo de excedente | Reativação | trivial |

**Fontes:** [Bunny Stream Pricing](https://bunny.net/pricing/stream/) · [Bunny docs pricing](https://docs.bunny.net/stream/pricing) · [Supabase Pricing](https://supabase.com/pricing) · [Supabase billing docs](https://supabase.com/docs/guides/platform/billing-on-supabase) · doc-norte interno §2/§6 · `plans.ts` do repo.

---

## ADENDO 2026-07-14 (noite) — Revisão pós-pushback do Patrick

### A. Quota de vídeo VISÍVEL: morta. Substituída por fair-use invisível (padrão do mercado)

Patrick apontou: nenhum concorrente mostra limite de GB na página de preços — quota visível cria barreira de percepção. **Verificado, ele tem razão na vitrine — mas todos controlam por baixo dos panos:**

- [Teachable tem uma Fair Use Policy formal](https://www.teachable.com/legal/fair-use-policy) (atualizada abr/2026) por trás do "unlimited"
- [Kajabi: "unlimited" com thresholds de fair use + soft throttling + cap de 4GB por upload](https://supplygem.com/kajabi-video-hosting/)
- Hotmart: R$0/mês mas cobra R$2,49/venda pelo player — a taxa É o limite
- Todos os SaaS têm piso de US$29–179/mês financiando o hosting; nós somos US$0/mês

**Decisão revisada:**
1. **Vitrine: "hospedagem de vídeo ilimitada"** em todos os planos — vira ARGUMENTO (único US$0/mês + sem taxa de player + ilimitado do mercado).
2. **ToS: cláusula de fair use** (mesmo instrumento de Teachable/Kajabi).
3. **Interno: tripwire anti-abuso invisível** — flag em conta com >100GB e 0 vendas em 90 dias → revisão/throttle de NOVOS uploads (nunca da entrega a alunos). ~1h de código (substitui o "soft cap 50GB" da Seção 6).
4. Diferenciação de planos volta a ser: **comissão + IA (rate limit) + suporte + perks** — sem quota de vídeo visível. O desenho original "planos só mudam comissão" estava mais certo do que o adendo de quotas.

### B. Viabilidade: site builder, automações, carrinho abandonado

Contexto verificado: [Eduzz/Nutror](https://blog.eduzz.com/artigo/nutror-eduzz-a-plataforma-mais-completa-para-cursos-online) NÃO é site builder — é área de membros (módulos/aulas, certificados, comentários, app, entrega automática por e-mail/SMS). Equivale ao que JÁ TEMOS (player + curso + certificados). O gap real vs Eduzz: automação de entrega por e-mail e app mobile.

| Feature | Esforço | Custo operacional | Quando | Nota |
|---|---|---|---|---|
| **Carrinho abandonado** | BAIXO (~1 sessão) | ~zero (e-mail transacional + cron; eventos Stripe já existem) | Roadmap P2 — 1ª da fila | Recupera tipicamente 5–15% dos checkouts abandonados. Dinheiro direto. |
| **Automações v1 (toggles, não builder)** | BAIXO-MÉDIO (1–2 sessões) | ~zero (n8n já roda) | P2 | Welcome no enroll · conclusão → certificado + upsell · liberação drip de módulos. Página de settings com switches, NÃO workflow builder visual. |
| **Página de venda por curso — block editor com templates CFP-safe** | MÉDIO (2–4 sessões) | zero | P2 (já era backlog §3.5 — vira o "nosso builder") | Templates prontos + blocos editáveis (hero, bio, FAQ, preço). Diferenciado: "publica e sai em conformidade com o CFP". |
| **Mini-site do creator + domínio próprio** | MÉDIO (domínio custom = Vercel for Platforms/wildcard) | ~zero-baixo | Fase 3 | Página pública de creator já é P2; domínio próprio vem depois. 80% do valor de um site builder por 20% do custo. |
| **Site builder completo (multi-página freeform)** | ALTO (produto inteiro; anos de moat do Kajabi) | médio | **Não fazer** | Posicionamento: "seu site é seu (dono da audiência); nós damos a página que converte e não viola o CFP". |

**Nada disso entra no escopo de launch** — entra no roadmap na ordem da tabela, financiado por GMV.

---

## ADENDO 2 (2026-07-14, noite) — Funil do creator, público em teste, doutrina de taxas

### C. O "site" esclarecido: funil de 3 páginas por creator (VIÁVEL — P2)

Patrick não quer site multi-página. Quer o **funil**: página de captura → página de vendas → checkout. Escopo e esforço:

| Peça | O que é | Esforço | Custo operacional |
|---|---|---|---|
| **Página de captura** | Form nome+e-mail → lista de leads no dashboard do creator + export CSV (futuro: alimenta automações) | 1–2 sessões | ~zero (Postgres) |
| **Página de vendas** | Editor de blocos (hero, bio, oferta, FAQ, garantia, CTA) com templates CFP-safe. **IA pré-preenche a copy** a partir dos dados do curso (título, descrição, bio) via DeepSeek — creator só edita | 2–4 sessões (evolução do §3.5 do doc-norte, que já era P2) | centavos (IA) |
| **Checkout personalizado** | Já existe (Stripe). Personalização: logo/cor do creator; order bump = futuro | pequeno | zero |
| **TOTAL funil** | O creator não precisa de Kajabi/Leadpages externo → stickiness | **~4–6 sessões** | ~zero |

Modo de preenchimento: **pré-definido pela IA + edição por bloco** (a opção "na unha" continua existindo — é só apagar). Diferencial: a copy gerada já sai validada contra o checklist CFP.

### D. Público-alvo: zona de teste (efeito "boneca") — decisão registrada

- NÃO hiperfocar messaging em psicólogo. Copy fala com **"terapeutas e profissionais do desenvolvimento humano"**, com selos diferenciando os regulados. (O doc-norte §3.1 já decidiu interface única + selos — esta decisão só ajusta o PESO do messaging.)
- O launch é o experimento: medir QUEM a oferta realmente atrai. Instrumento já existe de graça: o campo **"tipo de profissional"** do wizard (§3.3) → segmentar signup/publicação/venda por tipo no PostHog/dashboard KPI (que já é P0 do assessment de investidor).
- Critério: após ~90 dias, o segmento dominante (ex.: 99% holísticos) reorienta copy, catálogo em destaque e aquisição. Nada de travar avatar antes do dado.

### E. Doutrina de taxas (resposta ao "por que não cobrar como a Hotmart?")

**Pergunta genuína do Patrick: "se o cara armazenar muito vídeo e não vender, a gente tem prejuízo?"**
Resposta: sim, mas minúsculo e limitado. Creator morto com 40GB = **US$0,40/mês**. Cem creators mortos = US$40/mês (menos que a fatura do Supabase). O tripwire de fair use (Adendo A) corta a cauda. **Uma venda de US$100 no plano Free paga 20 meses-creator-morto.** Não é risco de negócio — e detalhe técnico: a taxa por venda da Hotmart NÃO protege contra esse cenário (creator morto não vende → não gera taxa → o custo de storage fica com a plataforma do mesmo jeito; quem protege é o fair use, que eles também têm).

**Doutrina adotada: "taxa só onde há custo real, publicada, e de preferência opt-in".** Análise linha a linha da tabela Hotmart:

| Taxa Hotmart | Custo real por trás | Nossa decisão |
|---|---|---|
| R$2,49/venda player (0,50 recorrência; 4,99+1 combo) | Entrega de vídeo (CDN) | **NÃO no launch** — nosso custo é 1–3% do take; cobrar mataria a manchete "8% e acabou". Fica no bolso: só reavaliar SE custo de vídeo passar de ~10% do take (hoje impossível com Bunny) |
| Parcelamento 3,49%/mês (repasse ou absorve, escolha do produtor) | Custo financeiro REAL do crédito | **ADOTAR quando ativar parcelamento BR** — mesmo mecanismo (creator escolhe repassar ou absorver), taxa = custo Stripe + margem mínima publicada |
| Antecipação de recebíveis (2,19–4,79%) | Custo de capital real | **ADOTAR como FEATURE futura (opt-in)** — Stripe Instant Payouts (~1–1,5%) + margem publicada. Linha de receita boa que ninguém percebe como taxa: quem não usa, não paga |
| Taxa de saque R$1,99 | Custo de payout do Stripe (centavos) | **NUNCA** — "saque grátis, sempre" é diferenciador barato e simbólico |
| Internacional 9,9% + US$0,50 | Processamento internacional | Já coberto pelo take + repasse Stripe (D2). Sem taxa extra |
| Spread de câmbio embutido | FX real do Stripe | **Repasse transparente à taxa publicada** — nunca spread escondido (é exatamente a "nebulosidade" que o público odeia) |

Síntese: o Patrick está certo que taxa atrelada a receita não machuca ("só paga quando faz dinheiro") — por isso parcelamento e antecipação entram. Mas a taxa de player especificamente resolve um problema que NÓS não temos (custo Bunny ≪ custo CDN da era em que a Hotmart criou a taxa) e custaria a arma de marketing mais forte. Transparência > mimetismo.

---

## ADENDO 3 (2026-07-14, noite) — Spec das Automações v1 + mapa consolidado do que é NOVO

### F. Automações v1 — página de settings com toggles (não é workflow builder)

Cada automação = um switch no dashboard do creator. Motor: n8n (já roda) + e-mail transacional. Custo operacional ~zero.

| # | Automação | Gatilho → Ação | Nota |
|---|---|---|---|
| 1 | Boas-vindas | Aluno compra/entra → e-mail de acesso + boas-vindas personalizável | Fecha o gap vs Eduzz/Nutror |
| 2 | Drip de conteúdo | Cronograma → libera módulos por data/intervalo | Padrão de mercado |
| 3 | Conclusão | Aluno termina curso → certificado + parabéns + upsell (próximo curso do creator) | Certificado já existe; automação conecta |
| 4 | Carrinho abandonado | Checkout iniciado sem concluir → e-mail em Xh com link | 1º da fila (dinheiro direto) |
| 5 | Re-engajamento | Aluno inativo N dias → "você parou na aula X" | Aumenta conclusão → aumenta LTV |
| 6 | Autoresponder de captura | Lead entra pela página de captura → sequência curta de boas-vindas | Depende do funil (Adendo C) |
| 7 | Pedido de avaliação | Conclusão → pedir review do CURSO | ⚠️ Review de aluno de curso ≠ depoimento de paciente (vedado CFP). Validador cuida da distinção |
| 8 | Notificações do creator | Venda / novo lead / marco atingido → notifica creator | Motivação + retenção do creator |

### G. Mapa consolidado — tudo que é NOVO vs plataforma atual (delta desta rodada de decisões)

**LAUNCH (escopo de código do lançamento):**
1. Flag modo-lançamento (assinaturas dormentes, tudo grátis + urgência)
2. Catálogo novo — 8 categorias do nicho, EN-first
3. Founding Pass (US$497): página + checkout único + entitlement vitalício + selo
4. Founding Builder (mérito): trava de comissão vitalícia + selo
5. Sell-gate + wizard de credenciamento + verificação automática (Stripe KYC, CRP/CNPJ/NPI, scoring IA, fila de exceção)
6. Vídeo híbrido: YouTube embed + upload Bunny (decisão anterior, estilo Eduzz)
7. AI advisor no painel do professor (sidebar flutuante, DeepSeek + n8n) + tutorial + messages
8. Tripwire fair-use de vídeo (invisível) + rate limit de IA
9. Dashboard KPI com segmentação por tipo de profissional (mede o "efeito boneca")
10. Curso âncora do avô (paralelo — testa o funil inteiro)

**P2 — PÓS-LAUNCH IMEDIATO (novidades desta sessão):**
11. Carrinho abandonado
12. Funil do creator: página de captura + lista de leads + export CSV
13. Página de vendas: editor de blocos + templates CFP-safe + IA pré-preenche copy
14. Checkout personalizado (logo/cor do creator)
15. Automações v1 (tabela F acima)
16. (Já eram P2 do doc-norte: product tour, selos nos cards, página pública do creator)

**FASE 3 / FUTURO (registrados, não construir agora):**
17. Antecipação de recebíveis opt-in (linha de receita, Stripe Instant Payouts + margem publicada)
18. Parcelamento BR (repasse/absorção à la Hotmart, transparente)
19. Mini-site do creator + domínio próprio
20. Plataforma-como-afiliado (~50% sobre vendas geradas pelo nosso marketing)
21. Programa de afiliados recorrente (estilo Skool 40%)
22. Diretório 1:1 — Fase 2 Opção B (agendamento+pagamento interno, vídeo externo)
23. Reativação dos planos (3 tiers: Free 8% / Creator ~$39 3% / Pro ~$99 1%)
