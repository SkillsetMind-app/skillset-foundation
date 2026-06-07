# Benchmark FASE 2 — Skool vs Skillset (evidência primária)

> **Data:** 2026-06-06
> **Método:** Evidência **primária** — assisti 2 vídeos reais do produto Skool via `/watch` (frames + captions) e cruzei com um **capability map do nosso código** (6 auditorias paralelas, file:line). **Cakto: exploração ao vivo na conta real** (logado, cliquei cada aba do editor, abri os builders de checkout/funil, criei um produto de teste do zero). No-Invention: cada alegação cita timestamp de vídeo, página oficial, ou `arquivo:linha` do nosso repo.
> **Fontes de vídeo:**
> - "How to Use Skool.com – Full Walkthrough & Demo 2025" (`youtube.com/watch?v=_TQoccbm9HA`, 12:47) — onboarding, community, classroom, discovery, checkout.
> - "How to Use Leaderboard in Skool [QUICK GUIDE]" (`youtube.com/watch?v=6Ed1HcHCcoo`, 2:19) — leaderboard, níveis, plugins de gating.
> - Skool Help Center (mecânica de pontos/níveis), Skool Affiliate page.

---

## 1. Anatomia do Skool (o que vi com meus olhos)

### Navegação (6 abas no topo da comunidade)
`Community · Classroom · Calendar · Members · Leaderboards · About` — confirmado no frame da classroom e da leaderboard.

### Gamificação — a mecânica completa (vídeo + Help Center)
- **Pontos:** **1 like = 1 ponto** para o autor do post/comentário. Criar post não dá ponto; *receber engajamento* dá. (Help Center + leaderboard video t=00:32).
- **9 níveis exponenciais:** L1=0, L2=5, L3=20, L4=65, L5=155, L6=515, L7=2.015, L8=8.015, L9=33.015 pts. Início rápido, topo leva meses.
- **Leaderboard:** 3 janelas — **7-day / 30-day / all-time** (frame da leaderboard mostra os 3 cards lado a lado), atualizado automaticamente por atividade.
- **Ladder visual:** página da leaderboard mostra os 9 níveis com cadeado + "% de membros em cada nível" + avatar do membro com "Level 1 · 5 points to level up".
- **Admin renomeia níveis:** modal "Make your group fun by naming your levels" (L1→"Hi!") (t=00:48).
- **Cursos destravados por nível:** no "Add course", o campo *"Who can access this course"* tem a opção **"Members of a certain level" + "Access starts at level N"** (frame do walkthrough t=01:17). → **gamificação amarrada à monetização**: conteúdo pago liberado por nível.
- **Plugins de gating por nível** (o dente da retenção, t=01:20–01:55):
  - **Unlock chat at Level 2/3:** "When groups get big, some people DM spam/pitch members. Unlocking chat... makes it harder for DM spammers because they need to contribute to the community to DM."
  - **Unlock posting at Level 2/3:** "requires members to earn the right to post by first contributing with comments."
  - → membro precisa **ganhar o direito** de postar/conversar subindo de nível. Anti-spam + loop de engajamento forçado.

### Arquitetura de settings (admin) — o que é "first-class" no Skool
Menu lateral de configurações observado nos frames: `Dashboard · Invite · General · Payouts · Pricing · **Affiliates** · Plugins · Tabs · Categories · Rules · **Discovery** · **Metrics** · Billing` (+ no walkthrough: **Subscriptions**, **Gamification**, **Billing & referrals**).
→ **Afiliados, Discovery e Gamificação são seções dedicadas de produto** — não add-ons.

### Onboarding & checkout
- Signup → código de verificação por email → "Create your community, free 14 days then **$99/month**, cancel anytime, **no hidden fees**".
- **Cartão exigido upfront** no trial; cobrança 1-clique.
- **Atribuição de referral exposta no checkout:** "**You were referred by** New York Angelo" (frame mobile t=08:38). O afiliado aparece no próprio fluxo de compra.

### Discovery
- `skool.com/discovery`: busca, **chips de categoria** (Business, Health & Fitness…), cards com logo/nome/descrição, badge **Private/Public · member count · Free/Paid**, ratings 5★ (social proof na about page).
- Comunidades **indexadas no Google** (descoberta orgânica) — vantagem nomeada do Skool.
- Mobile nativo (iOS/Android), push "Get app", "45% da atividade é mobile".

### Cakto (monetização — EXPLORAÇÃO AO VIVO na conta real, 2026-06-06)

> Naveguei a plataforma logada (conta do fundador), cliquei em cada aba do editor de produto, abri os builders e **criei um produto de teste do zero** ("Produto Teste Benchmark", R$97, formato Link de pagamento) para mapear o fluxo completo. Evidência = o que vi na tela.

**Fluxo de criação de produto (2 passos + aprovação instantânea):**
1. **Passo 1 — dados:** Tipo de pagamento (`Pagamento único` | `Assinatura recorrente`), Nome, **Descrição (mín. 100 caracteres, validado)**, **Página de Vendas (URL https obrigatória, validado)**, Preço.
2. **Passo 2 — "O que você vai vender?" (formato de entrega/fulfillment):** 7 opções — `Área de membros Externa` · **`Cakto Members` (recomendado, plataforma nativa de cursos+comunidade)** · `Área de membros Cakto V1` (legado) · `Telegram` · `Discord` · `Acesso por e-mail` · `Link de pagamento`.
3. **Aprovação instantânea:** "A aprovação do produto é instantânea, você pode cadastrar e já começar a vender." Zero curadoria/gate.

**10 abas no editor de produto** (adaptam-se ao formato): `Geral · Configurações · Order Bump · Upsell/Downsell · Checkout · Co-Produção · Cupons · Afiliados · Cakto Members [Beta] · Links`. (Produto Link-de-pagamento não exibe a aba Cakto Members → tabs dependem do fulfillment.)

**Order Bump** (aba dedicada): builder completo — **até 5 bumps por produto**, cada um com Produto/Oferta, "Aplicar desconto", CTA, Título, Descrição e **preview** do bump no checkout.

**Upsell/Downsell** (aba dedicada):
- Toggle "página de obrigado personalizada ou upsell" + campo URL (`Cartão ou Pix aprovado`).
- **Upsell 1-clique** (cartão salvo) com 2 builders: **`Gerador De Upsell`** (nativo) e **`Funeleiro`** — funnel builder visual da Cakto, hospedado em **domínio/SaaS separado** (`app.funeleiro.com.br`, login próprio), anunciado como "criador de funis gratuito da Cakto".
- Toggle "Redirecionar upsell ignorando falhas nos pagamentos de order bumps".
- Timing do e-mail de confirmação: imediato após pagamento **ou** após concluir as ofertas de upsell.

**Checkout** (aba dedicada): **múltiplos checkouts por produto** (lista com Nome/Preço/Oferta/Visitas; "+ Adicionar Checkout" → A/B e ofertas distintas). Abre o **Checkout Builder** (`app.cakto.com.br/checkout-builder/...`):
- **Drag-and-drop** com preview desktop/mobile.
- Componentes: `Texto · Imagem · Vantagens · Selo · Header · Lista · Cronômetro (escassez) · Depoimento · Mapa`.
- **Componentes EXTRAS (CRO, com toggle):** `Exit Popup` · `Notificação` (prova social) · `Chat`.
- **Tematização total** (aba Configurações do builder): Tema, Fonte, paleta de cores granular (texto primário/secundário/ativo, ícones, fundo, fundo do form de pagamento, botões).

**Afiliados** (aba dedicada, por produto): toggle habilita e revela — **Comissão % configurável**, **Atribuição** (`Último clique [recomendado]` | `Primeiro clique`), **Duração dos cookies** (dropdown, 30 dias default), **listar no marketplace público de afiliados**, aprovação manual de afiliação, **recebe comissão de upsell**, liberar dados de contato dos compradores ao afiliado, e-mail/descrição p/ afiliados, link da página de afiliado, clonagem de quiz.

**Cupons** (aba dedicada): Código, **Desconto %**, Data início, Data expiração (vazio = validade eterna), toggle **"Aplicar desconto aos Order Bumps"**. Lista com # de usos.

**Preços (na aba Geral):** **até 10 preços/ofertas por produto** ("Adicionar" + contador "1/10"), cada um com Nome/Preço/Tipo. **Garantia (reembolso) configurável** via dropdown (7 dias default). Imagem do produto (JPG/PNG, 10MB, 300x250px).

**Cakto Members** = LMS/área de membros nativa em subdomínio separado (`aluno.cakto.com.br`); vincular um produto a ela dispara **OAuth2 SSO** (`sso.cakto.com.br/oauth/authorize`, scopes openid+user+offers+products).

**Co-Produção** (aba dedicada): split de receita com parceiros/co-produtores. **Links** (aba): gestão de links de checkout.

**Mapa do ecossistema Cakto:** `app.cakto.com.br` (vendedor/checkout/pagamentos) + `aluno.cakto.com.br` (área de membros/LMS) + `app.funeleiro.com.br` (funnel builder visual) + **Vitrine** (loja pública do produtor, item de menu próprio). Dashboard mostra "Faturamento R$ X / R$ 10K" (meta gamificada) e banner "complete seu cadastro para fazer a primeira venda".

**Modelo de monetização do produtor (Perfil › Planos e Taxas, capturado ao vivo):** a Cakto cobra **take-rate diferenciado por método** + **calendário de payout escalonado por método** (quanto mais "líquido/instantâneo" o método, mais cedo cai o dinheiro):

| Método | Taxa do produtor | Recebimento (D+) |
|--------|------------------|------------------|
| **Pix** | **0% + R$ 2,49** | **1 dia** |
| Boleto | 4,99% + R$ 2,49 | 2 dias |
| Pix Automático | 8,99% + R$ 2,49 | 7 dias |
| **Cartão** | **4,99% + R$ 2,49** | **15 dias** |
| PicPay | 6,99% + R$ 2,49 | 15 dias |
| Apple Pay | 8,99% + R$ 2,49 | 30 dias |
| Google Pay | 8,99% + R$ 2,49 | 30 dias |

Extras de issuer/banking embutidos: **3DS** (autenticação segura de cartão, +3,99% por venda, opcional), **cartões virtuais** (3 grátis, depois R$ 2,49/cartão), **NFS-e automática** (0–100/mês grátis, 101+ = R$ 0,38/nota), **Cakto Banking** (conta bancária do produtor). → A Cakto não é gateway: é **PSP + banco + emissor fiscal** num produto só.

> **Espelho no nosso modelo (Stripe Connect, USD):** nós temos o análogo direto — `application_fee` + processing fee + payout delay. Mas o nosso payout-delay é **uma constante única** (`payoutReleaseDelayDays = 30`, `payment-rules.ts:12`), enquanto a Cakto **modula o delay por método de pagamento** (1d Pix → 15d cartão → 30d wallet). Isso é exatamente o que torna o item **T1 (payout-truth)** crítico: hoje nosso código diz 30, os docs dizem D+10, a UI diz 7 — três verdades. A Cakto prova que payout-timing transparente e diferenciado é tabela de produto, não letra miúda.

> Refresh anterior (consistente): order bump complementa o principal; upsell/downsell 1-clique sequencial (aceita→cross-sell, recusa→downsell); +25% no ticket médio; funil em <10 min.

---

## 2. Tabela "Eles têm / Nós não" (com file:line do nosso código)

| # | Capability (eles têm) | Skool/Cakto (evidência) | Nosso status | Nossa evidência (file:line) |
|---|----------------------|-------------------------|--------------|------------------------------|
| 1 | **Loop de gamificação** (likes→pontos→9 níveis→leaderboard) | Skool: 1 like=1pt, 9 níveis, leaderboard 7/30/all-time (vídeo+Help) | ❌ **zero** | Nenhum dos 5 primitivos. "likes" só em copy: `capabilities-grid.tsx:36`. `grep level/leaderboard/rank/points` = 0 hits funcionais. Feed existe (`course-community-feed.tsx`) mas sem engajamento mensurável. |
| 2 | **Gating por nível** (unlock chat/post/curso ao subir) | Skool plugins t=01:20; course access "Members of a certain level" t=01:17 | ❌ ausente | Sem modelo de nível → impossível gatear. |
| 3 | **Programa de afiliados** (40% recorrente, atribuição no checkout) | Skool: seção "Affiliates" + "You were referred by…" no checkout | ❌ ausente (base reusável) | `grep affiliate/referral` = 0 código. MAS ledger+transfer reusável: `index.ts:2039-2280`, `payout-ledger.ts`, `payment-split.ts`. TODO `AFF-1` em `docs/skillset-execution-backlog-2026-05-10.md:74`. |
| 4 | **Order bump no checkout** | Cakto (ao vivo): aba Order Bump dedicada, **até 5 bumps**, builder com desconto/CTA/título/preview; cupom pode aplicar aos bumps | ❌ ausente | `line_items` é item único: `index.ts:1416-1433`. Encaixa em `createCheckoutSession` (`index.ts:1300`) + flag via `request.data`. |
| 5 | **Upsell/downsell 1-clique pós-compra** | Cakto (ao vivo): aba Upsell/Downsell, **1-clique** (cartão salvo), 2 builders (`Gerador De Upsell` nativo + `Funeleiro` visual), página de obrigado custom, e-mail pós-upsell | ❌ ausente (sem primitive) | Sem off-session charge: `paymentIntents.create` = 0 hits em `functions/src`. `success_url` (`index.ts:1448`) vai direto pro curso. Course checkout usa `customer_email` only, "not a persistent Stripe Customer" (`index.ts:2946-2948`). |
| 4b | **Checkout builder (drag-drop, tema, CRO)** | Cakto (ao vivo): drag-drop, temas/fontes/cores, componentes cronômetro/depoimento/exit-popup/notificação/chat, **múltiplos checkouts por produto** | ❌ ausente | Stripe Checkout hospedado (fixo): `createCheckoutSession` `index.ts:1300`; sem builder, sem componentes, 1 checkout por curso. |
| 4c | **Multi-preço / multi-oferta por produto** | Cakto (ao vivo): **até 10 preços/ofertas** por produto (aba Geral) | ⚠️ parcial | 1 preço por curso; sem tabela de ofertas. |
| 3b | **Afiliados configuráveis (comissão/atribuição/cookie)** | Cakto (ao vivo): comissão %, último/primeiro clique, duração de cookie, marketplace público | ❌ ausente (base reusável — ver #3) | Ver item 3: ledger+transfer reusável (`index.ts:2039-2280`). |
| 6 | **Discovery orgânico (Google-indexed) + rich results** | Skool: comunidades indexadas, Discovery tab | ⚠️ **parcial — gap concreto** | Course `[slug]` **fora do sitemap** (`sitemap.ts:10-28`); **ZERO JSON-LD** (`grep JsonLd/schema.org/@type` = 0 hits) → sem rich results no Google. Browse+busca existem (`course-marketplace.tsx`) mas busca é `String.includes` client-side (`:157-167`). |
| 7 | **Ranking/sort no catálogo** (trending/featured) | Skool Discovery ordena por membros/atividade | ⚠️ parcial | "Featured" = slice fixo dos 6 primeiros (`featured-courses.tsx:12`); sort só A→Z (`published-courses.ts:43`); sem trending/popularity (`grep trending/ranking` = 0). |
| 8 | **Members directory** (roster, perfis, níveis, online) | Skool: aba Members | ❌ stub | Placeholder hardcoded: `course-community-feed.tsx:254-263` ("richer member directory comes later"). |
| 9 | **Posts fixados + replies aninhados** | Skool: pin + threading | ⚠️ parcial | "announcement" é só categoria, sem pin (`grep pinned` = 0); comentários single-level, "Reply" posta top-level (`course-community-feed.tsx:475`). |
| 10 | **Quizzes/assessment** | Skool 2025 | ❌ stub | `quiz` é tipo de lição mas runtime é placeholder: `enrolled-course-workspace.tsx:722` ("when assessment tools are connected"). Sem modelo de question/answer/grade. |
| 11 | **Transcrições de aula** | Skool 2025 | ❌ ausente | Toggle `autoCaptions` é só preferência passiva (`user-profile.ts:35`); sem pipeline de caption. |
| 12 | **Assinatura recorrente** (modelo nativo do Skool) | Skool inteiro é assinatura $99/mo | ⚠️ pronto-mas-desligado | Backend aceita `subscription_monthly/yearly`; UI desabilita "Coming soon" (`course-builder-studio.tsx`). |

---

## 3. O que NÓS temos que o Skool não tem (forças a preservar)

| Força | Evidência |
|-------|-----------|
| **Certificados nativos** com verificação pública | `issueSkillsetCertificate` (`index.ts:2285`), `verifySkillsetCertificateHttp` (`:2757`). Skool **não tem**. |
| **Drip sofisticado** (5 estratégias, enforced) | `drip-policy.ts:83-139` (instant/sequential/time-lesson/module/custom). Iguala ou supera Skool. |
| **Split de comissão por tier** + multi-moeda + refund com reversão proporcional | `payment-split.ts`, `payment-rules.ts`, 30 moedas, `createReleasedRefundTransferReversal`. |
| **Eventos + RSVP realtime + moderação** | `learn-events-hub.tsx`, `teacher-event-studio.tsx`, `community-moderation-queue.tsx`. |
| **Marketplace de cursos avulsos** (vs Skool, que vende comunidade, não curso) | `course-marketplace.tsx`. Posicionamento diferente. |

---

## 4. Leitura estratégica

1. **O fosso do Skool é o loop de gamificação com dentes** — não os pontos em si, mas o **gating por nível** (postar/conversar/destravar curso exige subir), que transforma engajamento em obrigação e mata spam. É o que prende. Nosso item #1 do backlog (C1) deve mirar o loop MVP (likes→pontos→níveis→leaderboard) e, na sequência, o **gating** (a parte que realmente retém e amarra à monetização).
2. **Afiliados é o gap de maior alavancagem de aquisição** e temos **meio caminho andado** no backend (ledger + Stripe Connect transfer). É o único big-bet com fundação reusável.
3. **SEO/discovery orgânico é fruto baixo e caro de ignorar:** falta JSON-LD e os cursos não estão no sitemap. Isso é o que dá ao Skool o "Google-indexed". Esforço baixo, impacto de aquisição alto.
4. **Order bump > upsell** em ordem de ataque: order bump encaixa no checkout atual (`line_items`), enquanto upsell exige construir um primitive de off-session charge que hoje **não existe**. Comece pelo bump.
5. **Nossas forças (certificados, drip, refund) são reais e raras** — devem virar narrativa de diferenciação, não ficar escondidas.

---

*FASE 2 aprofundada com evidência primária de vídeo + capability map de código. Alimenta o `docs/BACKLOG-MELHORIA-2026-06-06.md` (itens competitivos C1–C9 refinados).*
