# Plano Mestre — Recursos por Plano

**Data:** 2026-08-08
**Status:** em execução (sub-planos 0, 1, 2, 3 e 4 entregues — próximo: 5)

---

## 1. Honestidade sobre a pesquisa de fornecedores

Patrick perguntou: eu pesquisei de verdade na internet, ou trouxe o que já sabia?

**Resposta honesta: foi uma verificação de candidatos fortes, não uma varredura de mercado.**

| Verifiquei na fonte (preço oficial lido) | NÃO pesquisei |
|---|---|
| Cloudflare Stream | Mux, Agora, 100ms, Whereby, Amazon IVS, Zoom Video SDK, Jitsi self-hosted |
| Daily (Video SDK) | Amazon SES, Postmark, SendGrid, Mailgun, Loops, Brevo |
| LiveKit | |
| Bunny Stream | |
| Resend | |

Os números que passei dos 5 verificados são reais e lidos na fonte. Os outros nomes eu simplesmente não olhei. Se algum deles for materialmente mais barato, eu não saberia dizer hoje.

**Números confirmados (USD):**

| Fornecedor | Preço |
|---|---|
| Cloudflare Stream | $5 / 1.000 min armazenados · **$1 / 1.000 min entregues** · ao vivo e gravado cobram igual · sem mínimo mensal |
| Daily | 10.000 min-participante grátis/mês · **$0,004 / min-participante** vídeo · $0,00099 só áudio · sem taxa base |
| LiveKit | Build $0 · Ship a partir de $50/mês · 5.000 min WebRTC grátis · banda $0,12/GB |
| Bunny Stream | **só VOD, não faz ao vivo** · storage a partir de $0,01/GB |
| Resend | 3.000/mês grátis · Pro $20 por 50k · Scale $90 por 100k |

**A bifurcação de custo que mais importa (4x):** aula de 90 min com 100 alunos custa **$9,00** em transmissão (Cloudflare Stream, aluno só assiste) contra **$36,36** em videoconferência real (Daily, todo mundo com câmera aberta). A "masterclass / live" que o Patrick descreveu é o formato transmissão. Recomendo transmissão. Decisão dele.

---

## 2. Modelo de planos reformulado

### O problema do modelo atual

Hoje o plano muda **uma coisa só**: a taxa de comissão. Todo recurso está em todo plano. Isso não dá motivo nenhum pra alguém subir de plano.

### O novo formato: assinatura de IA

Preço fixo por mês compra uma **cota**. O professor vê o número antes de assinar. Quando estoura, pede expansão em vez de bater num muro.

### Tabela de cotas proposta (números precisam da aprovação do Patrick)

| Recurso | Free $0 | Starter $19 | Pro $89 | Plus $199 |
|---|---|---|---|---|
| Produtos publicados | 1 | 5 | 25 | ilimitado |
| Alunos ativos (assentos) | 50 | 300 | 2.000 | ilimitado |
| **Aula ao vivo por link próprio** | **sim** | **sim** | **sim** | **sim** |
| **Sala ao vivo hospedada** | *adiado — ver §2.1* | | | |
| Armazenamento de vídeo (min) | 60 | 600 | 3.000 | 10.000 |
| Destaques no marketplace | — | 1 | 3 | 5 |
| Cupons ativos | 3 | 20 | 100 | ilimitado |
| Domínio próprio | — | — | 1 | 3 |
| Assentos de equipe | 1 | 2 | 5 | 15 |
| Disparos de e-mail/mês | — | 2.000 | 10.000 | 50.000 |
| Tirar a marca SkillsetMind | não | não | **sim** | **sim** |
| Certificado com logo próprio | não | **sim** | **sim** | **sim** |
| Template de site | não | **sim** | **sim** | **sim** |

## 2.1 Aula ao vivo — modelo híbrido (DECIDIDO 2026-08-08)

A checagem de conflito achou que **aula ao vivo já existe na plataforma**: `CourseEvent.externalUrl` (`src/domain/course-event.ts`) guarda o link que o próprio professor cola, com RSVP, agenda e páginas em `/teach/events` e `/learn/events`. A sala é dele. **Custo nosso: $0.**

Isso derruba a premissa da tabela de minutos que estava aqui. Decisão fechada, mesmo desenho já adotado para vídeo gravado (YouTube embed grátis + upload Bunny pago):

| | Link próprio (Zoom/Meet do professor) | Sala hospedada por nós |
|---|---|---|
| Existe hoje | **sim** | não |
| Quem paga a transmissão | o professor | **nós** |
| Disponibilidade | ilimitado, **todos os planos, inclusive Free** | limitado, planos pagos |
| Status | no ar | **adiado** — construir depois dos sub-planos 2 a 8 |

**Fórmula de custo, para quando a sala hospedada entrar:** Cloudflare Stream cobra $1 a cada 1.000 minutos entregues, e "entregue" conta por pessoa.

> **custo USD = duração(min) × pessoas ÷ 1.000**

Uma aula de 2h com 200 alunos = $24. Quatro delas = $96, contra os ~$194/mês que um Pro rende (assinatura + comissão). Por isso a sala hospedada nasce apertada, e não como cota generosa.

**Como será medida (quando existir):** três números legíveis — **quantas aulas por mês · duração máxima · pessoas na sala** — e não o balde de "minuto-espectador" que este documento carregava antes. Três botões multiplicados explodem o custo (Plus a 40 × 240 × 500 = $4.800), então os limites saem calculados de trás pra frente: pior caso possível ≤ ~20% da receita do plano.

**Por que ninguém fica sem aula:** estourou a cota da sala hospedada, o professor cola um link do Zoom. Nunca há corte no meio da aula.

`src/domain/entitlements.ts` não carrega cota de aula ao vivo — por isso.

### Pedido de expansão

Uma tabela só, `entitlement_requests`, guarda o pedido e a liberação. A concessão ativa é a última linha aprovada. Expansão só **aumenta** limite — nunca reduz.

---

## 3. Ordem dos sub-planos

Critério: **(valor × velocidade) ÷ risco**. Nada que mexe no caminho do dinheiro vem antes do que não mexe.

| # | Sub-plano | Por que nessa posição | Tempo |
|---|---|---|---|
| **0** | Mapa de cotas (`entitlements.ts`) | Espinha de todos os outros. Sem ele, cada recurso vira um portão feito à mão. | ½ dia |
| **1** | **Destaque no marketplace** | Motor já existe (`featured` + `featured_rank` + índice). Falta só o autoatendimento. Primeira diferenciação de plano da história da plataforma. | 1 dia |
| **2** | Certificado com logo do professor | O slot de co-marca **já está desenhado e renderizado** — só nunca foi alimentado. Trabalho mais barato do repositório. | ½ dia |
| **3** | Template de site (vitrine pública) | O editor existe e salva. O que falta: a projeção pro perfil público e os presets virarem CSS de verdade. | 2 dias |
| **4** | Tirar a marca | Depende do 3. Um ponto único de troca (`LogoWordmark` / `BrandName`). | 1 dia |
| **5** | Cupom em todos os planos | Quase pronto. Buraco: checkout de assinatura ainda não aceita cupom. | 1 dia |
| **6** | Métodos de pagamento por país | Código já está certo (não fixa `payment_method_types`). É configuração de conta Stripe + documentação pro professor. | 1 dia |
| **7** | Domínio próprio | Depende de verificar preço por domínio na Vercel — ainda não confirmei. | 2 dias |
| **8** | Upsell / downsell / order bump | Greenfield e mexe no caminho do dinheiro. Último de propósito. | 3-4 dias |
| **9** | Sala ao vivo hospedada | **Adiado por decisão do Patrick (2026-08-08).** O link próprio já cobre a necessidade a custo zero; a sala nossa é o único item que pode dar prejuízo. Ver §2.1. | depois do 8 |

---

## Sub-plano 0 — Mapa de cotas

**Meta:** um único lugar que responde "o plano X libera quanto de Y".

**Feito:** `src/domain/entitlements.ts` — mapa plano→cota, `effectiveLimit` (mescla padrão do plano com expansão concedida), `quotaStatus` (usado/limite/restante para a barra de progresso), `hasFeature`, `lowestPlanWithFeature` (alimenta o texto "Assine o Pro").

**Regra que mantém honesto:** o número no TypeScript serve pra UI. **Quem faz valer é o banco.** Se os dois divergirem, o banco ganha.

---

## Sub-plano 1 — Destaque no marketplace

**Meta:** o professor destaca o próprio curso sozinho, dentro da cota do plano dele.

### A trava real

`featured` e `featured_rank` são **colunas congeladas**. O gatilho `courses_freeze_privileged_columns()` levanta exceção a menos que quem escreve seja service_role, admin, ops — **ou** que `skillset.trusted_write` esteja ligado.

Consequência: **um update direto do navegador nunca vai funcionar.** Precisa de uma função SQL `SECURITY DEFINER` que confere a cota e só então liga o `trusted_write`. Seis funções do schema já usam essa mesma saída.

### Passos

1. Migração com a RPC `set_own_course_featured`: confere dono → confere publicado → conta destaques atuais → compara com a cota do plano → liga `trusted_write` → grava.
2. Função irmã `get_featured_quota` devolve usado/limite pra tela.
3. Botão na gestão de cursos com "N de M destaques usados".

### Onde a cota mora no SQL

Duplicar o mapa inteiro em SQL seria convite a divergência. Só a cota de destaque desce pro banco, num `CASE` de quatro linhas, com comentário apontando pro TypeScript. O resto continua só na UI.

---

## Sub-plano 2 — Certificado com a marca do professor

**Meta:** o certificado que o aluno baixa carrega a marca do professor, não só a da SkillsetMind.

### A checagem de conflito de novo

Praticamente tudo já existia:

| Peça | Onde | Estado |
|---|---|---|
| Upload do logo pelo professor | `storefront-settings-panel.tsx` → `users.storefront.branding.logoUrl` | **já existia** |
| Coluna no certificado | `certificates.sponsor_logo_url` | **já existia** |
| Desenho do logo no documento | `certificate-document.tsx:48` | **já existia** |
| Gravação do logo na emissão | `issue_skillset_certificate` | **gravava `null` fixo** |

Ou seja: o recurso inteiro estava pronto menos um `null` numa linha de SQL. Nada de coluna nova, nada de upload novo.

### O que mudou

1. Migração `20260808130000_certificate_teacher_brand_logo.sql` — a RPC de emissão passa a ler o logo do dono do curso e gravar, com trava de plano (`current_plan_id <> 'free'`) e validação `https://`.
2. O rótulo impresso virou **"Course by"** (era "In partnership with", que só fazia sentido para patrocinador de terceiro).
3. O campo de upload da vitrine agora avisa que aquele mesmo logo vai pro certificado — recurso que ninguém descobre não foi entregue.

**Snapshot, não referência:** o logo é congelado na PRIMEIRA emissão. Professor que troca de logo depois não reescreve certificado que já está na mão do aluno; professor que cai de plano não perde a marca do que já emitiu.

---

## Sub-plano 3 — Template de site (vitrine pública)

**Meta:** o que o professor escolhe no editor de vitrine aparece de verdade na página pública dele.

### A checagem de conflito de novo

| Peça | Onde | Estado |
|---|---|---|
| Editor de vitrine (cor, logo, capa, tema, ordem dos cursos) | `/teach/storefront` → `users.storefront` | **já existia** |
| Página pública do professor | `/instructors/[slug]` | **já existia** |
| Tabela pública lida por anônimo | `public_profiles` | **já existia** |
| Gatilho que projeta o perfil | `sync_public_profile()` | **copiava 6 colunas e ignorava `storefront`** |

**O diagnóstico:** não faltava página, faltava fio. O editor gravava num beco sem saída — nada do que o professor escolhia chegava à página pública. Sub-plano 3 nunca foi "criar a vitrine", foi "fazer o editor chegar nela".

### O que mudou

1. Migração `20260808140000_storefront_public_projection.sql`:
   - coluna `public_profiles.storefront`;
   - função `public_storefront_projection(storefront, plan_id)` com as duas travas;
   - o gatilho passa a projetar a vitrine, e `storefront, current_plan_id` entram na **lista de colunas do `after update of`** — sem isso a projeção congelaria no valor antigo;
   - backfill dos perfis existentes + `assert` que falha se algum `free` ficar com vitrine publicada.
2. `rowToPublicProfile` passa o campo adiante; `PublicProfile.storefront` no domínio.
3. `instructor-profile-view.tsx` renderiza: faixa de acento, capa, logo, tagline e a **ordem escolhida** dos cursos (destacado primeiro, depois a ordem do editor, o resto no fim — mesma convenção `?? MAX_SAFE_INTEGER` do marketplace).
4. `globals.css`: presets `warm` / `cool` / `mono` viram gradiente de verdade, com override para o modo escuro.
5. Teste de deriva em `entitlements.test.tsx` — o terceiro do repositório — trava `storefrontTemplates` junto com o SQL.

### As duas travas moram no SQL

Seguindo a regra do sub-plano 0 (*"o número no TypeScript serve pra UI; quem faz valer é o banco"*):

| Trava | Por quê |
|---|---|
| Plano (`free` projeta `null`) | Espelha `features.storefrontTemplates`. Quem cai de plano perde a vitrine na próxima escrita, sem job de limpeza. |
| Sanitização (só `https://`, só hex de 6 dígitos, só tema da lista) | `public_profiles` é lida por `anon` e a cor de acento vira **CSS custom property**. É a fronteira de confiança — nunca confiar no que o cliente gravou.

O tema vai pro HTML como `data-storefront-theme`, não como classe: React escapa valor de atributo, então um tema desconhecido simplesmente não casa com nenhuma regra CSS e cai no padrão.

**`logoUrl` já é projetado mas quase não é usado** — uma marca de 28px ao lado do kicker. O sub-plano 4 (tirar a marca) vai precisar dele na página pública; projetar agora evita uma segunda migração.

---

## Sub-plano 4 — Tirar a marca SkillsetMind (whitelabel)

**Meta:** no plano pro e acima, o aluno vê a marca do professor onde antes via a nossa.

### A checagem de conflito de novo

Desta vez o resultado foi o oposto dos anteriores: **não existia nada.** `removePlatformBranding` era um booleano em `entitlements.ts` que ninguém lia. A feature estava vendida na tabela de planos e não tinha nenhuma implementação — nem no certificado, nem na área de membros, nem na vitrine.

| Peça | Estado antes |
|---|---|
| `features.removePlatformBranding` (pro/plus) | existia, **não era lido por ninguém** |
| Cabeçalho do certificado | logo SkillsetMind fixo |
| Cabeçalho da área de membros | `LogoWordmark` fixo |
| Coluna/flag no banco | não existia |

### Duas superfícies, dois mecanismos

A escolha do mecanismo veio do **tempo de vida** de cada peça:

| Superfície | Mecanismo | Por quê |
|---|---|---|
| Certificado | **snapshot** na emissão (`certificates.hide_platform_brand`) | O PDF fica na mão do aluno para sempre. Se o professor cair de plano em 2027, não podemos reimprimir a nossa marca num diploma já emitido. |
| Área de membros | **ao vivo**, via projeção (`branding.hidePlatformBrand`) | É uma página renderizada a cada visita. Caiu de plano, a nossa marca volta na próxima escrita do gatilho — sem job de limpeza. |

**Por que não derivar do `sponsorLogoUrl`:** o logo do professor no certificado é `starter+` (sub-plano 4 é `pro+`). São duas travas diferentes de propósito — starter **co-assina**, pro **substitui**. Derivar uma da outra daria whitelabel de graça no starter.

### O que mudou

1. Migração `20260808150000_whitelabel_platform_brand.sql`:
   - coluna `certificates.hide_platform_brand`;
   - `issue_skillset_certificate()` grava a trava do dono no momento da emissão;
   - `public_storefront_projection()` passa a emitir `branding.hidePlatformBrand`;
   - backfill dos perfis já publicados + dois `assert` (nenhum plano barato com a flag, nenhum pro/plus sem ela).
2. `certificate-document.tsx`: sob whitelabel, o logo do professor toma o cabeçalho, o `authorityLabel` some e o corpo deixa de dizer "the SkillsetMind program".
3. `member-area-shell.tsx`: novo prop `brand`, resolvido no servidor pelo `learn/courses/[slug]/page.tsx` — precisa estar na primeira pintura, senão o aluno vê a nossa marca piscar e sumir.
4. Quarto teste de deriva em `entitlements.test.tsx`, travando `removePlatformBranding` junto com o SQL.

### O que a marca NUNCA some

O **código de verificação** e o `Verify at skillsetmind.com/verify` continuam impressos em todos os planos. É o que torna o diploma checável — sem isso o certificado não vale nada, e a "marca" que ele carrega é o que dá credibilidade ao documento do professor, não o contrário.

### Duas exclusões deliberadas

| Superfície | Decisão | Por quê |
|---|---|---|
| Marca d'água no vídeo | **fora** | `watermarked-video-player.tsx` só é chamado pelo `enrolled-course-workspace.tsx`, que é o ramo do catálogo de demonstração. Nenhum aluno de professor real passa por ali — whitelabelizar não muda nada hoje. |
| Nav/rodapé da vitrine pública | **adiado para o sub-plano de domínio** | Tirar a nossa marca de `skillsetmind.com/instructors/slug` enquanto a URL ainda diz skillsetmind.com é teatro. A Hotmart vende whitelabel como domínio próprio + área de membros no mesmo pacote. |

### Uma flag verdadeira, nunca falsa

A projeção emite `hidePlatformBrand: true` **ou nada** — nunca `false`. `public_profiles` é lida por `anon`: publicar `false` diria a qualquer visitante quais professores estão no plano barato. O `jsonb_strip_nulls` remove o campo quando a trava não se aplica, e o cliente lê ausência como "não incluído".
