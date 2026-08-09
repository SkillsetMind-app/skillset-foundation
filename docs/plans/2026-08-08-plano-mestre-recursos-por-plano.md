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
| **Cupons** | **ilimitado** | **ilimitado** | **ilimitado** | **ilimitado** |
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
| **10** | Área de membros (catálogo, cadeado, proteção de vídeo) | Escopo novo de 2026-08-08. Posição **provisória**: 4 das 7 peças já existem, mas o tamanho real só fecha quando o Patrick mandar os prints do design. | a definir |

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

---

## Sub-plano 5 — Cupom em todos os planos

**Meta:** o cupom que já funcionava na compra avulsa passar a funcionar também na assinatura, e o professor poder receber desconto de lançamento no plano dele.

### A checagem de conflito: quase tudo já existia

| Peça | Estado antes | Onde |
|---|---|---|
| Validação do cupom (código, validade, limite, "não pode zerar") | **já existia** | `src/domain/coupon-redemption.ts` |
| Tela do professor para criar cupom | **já existia** | `/teach/coupons` |
| Tabelas no banco | **já existiam** | `course_coupons` + `course_coupon_reservations` |
| Reserva / baixa / devolução | **já existiam** | 3 RPCs, chamadas pelo webhook |
| Cupom na compra **avulsa** | **já funcionava** | `payments/checkout` |
| Cupom na **assinatura** | **bloqueado de propósito** | o código dizia literalmente *"não suportado ainda, use produto avulso"* |

Ou seja: o sub-plano 5 foi **tapar um buraco**, não construir um sistema.

### As quatro armadilhas

Assinatura não é compra avulsa, e ligar o cupom sem pensar quebra em quatro lugares diferentes:

**1. Desconto dobrado.** Na assinatura, o preço recorrente é criado na Stripe a partir do valor do curso. Se eu descontasse o valor *antes* de criar esse preço, o desconto ficaria colado no preço **para sempre** — e ainda levaria o cupom por cima na primeira fatura. O professor perderia metade da mensalidade de cada aluno, para sempre, sem conseguir desfazer. Solução: o preço nasce **cheio**; o desconto viaja separado, como cupom da Stripe.

**2. Cupom na conta errada.** O dinheiro vai direto do aluno para o professor (a plataforma nunca toma posse). Isso significa que o cupom, igual ao preço, tem que existir na conta **do professor** — um cupom criado na nossa conta simplesmente não é enxergado pelo checkout dele.

**3. Queimar o cupom todo mês.** A renovação carrega a mesma etiqueta da assinatura original. Sem trava, um único aluno consumiria uma vaga do cupom por mês, para sempre. Solução: a baixa só acontece na **primeira** fatura.

**4. Perder ou soltar a reserva na hora errada.** Se a Stripe falhar, a reserva é devolvida. **Exceto** quando não deu para cancelar a sessão — aí ela pode ainda ser paga, então a reserva **fica de pé**.

### A decisão que precisa aparecer na tela

`course_coupons` **não tem campo de duração**. O professor escreve "25%" e não tem como dizer "só no primeiro mês". Um percentual que se repete para sempre é a armadilha nº 1 de novo, agora por escolha do professor.

Decisão: **o cupom vale na primeira cobrança**. É o padrão da Hotmart e da Eduzz, e é o lado reversível — dá para soltar depois; não dá para tirar de assinante que já entrou.

> ⏳ **Dívida assumida:** falta escrever isso na tela `/teach/coupons`. Hoje o professor não é avisado. Entra na próxima leva.

### Desconto no plano do professor (o outro lado do balcão)

Uma linha: o checkout do plano agora aceita **promotion code** da Stripe. Cupom de fundador / lançamento é criado direto no painel da Stripe — sem banco, sem tela, sem código nosso.

### Prova

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | limpo |
| `eslint .` | limpo |
| `vitest run` | 415/415 |
| Preço recorrente sai cheio mesmo com cupom de 25% | testado |
| Cupom vai na conta do professor, não na nossa | testado |
| Compra avulsa continua descontando o valor de verdade | testado |

Commit `ce6740f`.

### 5.1 Quantos cupons cada plano pode criar — DECIDIDO: ilimitado (2026-08-08)

Patrick: *"n vejo pq limitar quantidade de cupom pode deixar ilimitado para a pessoa escolher quantos"* + *"independente do plano/assinatura"*.

A checagem de conflito achou que o limite **nunca existiu de verdade**. `activeCoupons` estava declarado em `src/domain/entitlements.ts` com 3 / 20 / 100 / ilimitado, mas sem **nenhum** consumidor: nenhuma tela lia, nenhuma rota lia, nenhum SQL barrava, nenhum teste citava. Era uma promessa morta — o professor no plano free já podia criar 300 cupons hoje e nada o impediria.

Então o pedido não virou funcionalidade, virou **deleção**: tirei a chave para ninguém construir depois um teto que ele não quer. Deletei em vez de zerar (`null` nos quatro planos) porque uma chave ilimitada em todo plano não diferencia plano nenhum — é ruído num mapa cujo único trabalho é responder "o que o plano X libera".

Razão gravada no código, acima de `QuotaKey`: **um cupom não custa nada para guardar e só dispara quando gera uma venda da qual tiramos comissão.** Limitar cupom é cobrar pedágio do professor por tentar vender.

Commit `be4ecd5`. Portões: tsc limpo, eslint limpo, 415/415.

**Ponta solta (não é o que ele pediu, fica registrada):** o limite de *usos por cupom* (`max_redemptions`) continua obrigatório na tela — mínimo 1, campo não aceita vazio. Isso é escolha do professor, não do plano, mas hoje ele não consegue criar um cupom de usos ilimitados. Uma linha para resolver, se ele quiser.

---

## Sub-plano 10 — Área de membros: catálogo, cadeado e proteção de vídeo

> Escopo pedido em 2026-08-08. **Registrado, não executado** — entra depois do 6 (métodos de pagamento). O Patrick vai mandar prints do design antes da execução.
>
> *Renumerado de 7 para 10: o 7 já era "Domínio próprio" na tabela do §3 e dois sub-planos com o mesmo número viravam confusão na hora de dizer "faz o 7".*

### A checagem de conflito: 4 das 7 peças já existem

| Peça pedida | Estado | Onde |
|---|---|---|
| Embed de YouTube | **já existe** | `domain/lesson-embed.ts` — e já usa `youtube-nocookie.com` |
| Liberação gradual (drip) | **já existe, completo** | `domain/drip-policy.ts` — 5 estratégias |
| Aula de degustação grátis | **já existe** | `freePreviewLessonId` no builder |
| Botão Preview do professor | **existe, mas errado** | `/teach/builder/[id]/preview` abre dentro do painel, não da área de membros |
| Grade estilo Netflix do catálogo do professor | **não existe** | — |
| Cadeado + modal de detalhes + comprar | **meio existe** | `domain/course-access.ts` decide os 4 modos; não há UI |
| Checkout por curso | **já existe** | modo `paid_checkout_required` |

**As 5 estratégias de drip que já estão prontas** (o professor escolhe na aba Pricing):

| Estratégia | O que faz |
|---|---|
| `instant` | Libera tudo na hora da compra |
| `sequential_progress` | Só libera a próxima aula quando a anterior é concluída |
| `time_drip_lesson` | Uma aula a cada N dias |
| `time_drip_module` | Um módulo a cada N dias |
| `time_drip_custom` | Prazo por aula — é assim que se libera "3 aulas de uma vez" (mesmo prazo nas três) |

Ou seja: o pedido "liberar de 7 em 7 dias, ou um módulo de uma vez, ou tudo junto" **já está construído**. O que falta é o professor conseguir enxergar isso e o aluno ver o cadeado.

### A verdade sobre proteger vídeo do YouTube

**Não dá para impedir. Isso não é limitação do nosso código — é como o YouTube funciona.**

O vídeo é servido pelos servidores do YouTube. Para o navegador do aluno tocar o vídeo, o endereço dele precisa estar escrito no HTML da página. Qualquer pessoa aperta F12 e lê em 5 segundos. Bloquear botão direito, esconder o logo, tapar o canto "Assistir no YouTube" — tudo isso segura o curioso, **nenhum deles segura quem quer piratear**.

O YouTube também **não** oferece trava de domínio para canais comuns (só o Vimeo e os players pagos oferecem). Então não existe um botão mágico do nosso lado.

**O que realmente protege é o Bunny Stream** — link assinado que expira, lista de domínios autorizados e DRM opcional. Isso é cadeado de verdade.

**Decisão de produto:** vídeo protegido vira **recurso de plano**, não promessa vazia.

| Fonte de vídeo | Proteção real | Custo pro professor | Plano |
|---|---|---|---|
| YouTube embed | Nenhuma. Só freio de mão. | R$0 | qualquer um, inclusive free |
| Bunny Stream | Link assinado + domínio travado | pago (nosso custo) | planos pagos |

Isso transforma a limitação técnica em motivo de upgrade — e, mais importante, **para de mentir pro professor**.

O que entra do lado do YouTube (rotulado como o que é — freio de mão, não cadeado):
1. Camada por cima do iframe que engole o botão direito e o clique no canto "Assistir no YouTube";
2. `modestbranding` + `rel=0` + teclado desabilitado nos parâmetros do embed;
3. **Aviso honesto no editor**, ao lado do campo do link: *"YouTube não pode ser protegido. Marque o vídeo como Não listado no YouTube e considere o Bunny se o conteúdo for pago."*

O item 3 é o de maior valor real e é **do lado do professor**: vídeo Não listado não aparece em busca. Continua acessível a quem tem o link, mas some do YouTube público.

### A pergunta estrutural que ainda está aberta

O Patrick perguntou: *"é curso com módulos, ou curso composto de subcursos?"*

**Hoje a plataforma é `Curso → Módulos → Aulas`** — é o que o `drip-policy.ts` percorre. O que ele chamou de "trilhas com vários cursos dentro" seria um **quarto nível que não existe**.

| Caminho | Custo | Consequência |
|---|---|---|
| **A. Manter 3 níveis** | R$0 | A "trilha" vira um curso com módulos grandes. É o que Hotmart e Kajabi fazem. |
| **B. Adicionar trilhas** | Alto — mexe em matrícula, drip, certificado e checkout | Necessário só se ele vender pacote de vários cursos como um produto único |

**Recomendação: A**, até existir um professor pedindo B. O agrupamento visual ("trilhas") pode ser feito com os rótulos de seção da vitrine, que **já existem** (`storefront.showcase.sectionLabels`).

### O que entra no sub-plano 7

1. **Grade do catálogo dentro da área de membros** — todos os cursos daquele professor, comprados e não comprados, capa + cadeado, placeholder quando não há capa.
2. **Modal de detalhes** no clique do cadeado (janela por cima, não página nova) → botão que leva ao checkout do curso. O cérebro (`getCourseAccessDecision`) já existe.
3. **Preview do professor virar visitante de verdade** — trocar `PlatformShell` por `MemberAreaShell` na rota que já existe, e mostrar a grade, não só um curso.
4. **Proteção de vídeo em dois níveis** conforme a tabela acima.
5. **Deixar o drip visível** — ele está construído e escondido.

**Bloqueado até:** prints do design atual (o Patrick vai mandar) + decisão A/B da estrutura.

---

## 11. Auditoria completa — resultado consolidado (2026-08-09)

Quatro ondas de agentes + o `performance advisor` do Supabase. Isto é o
resultado final, segmentado por **prioridade** e por **quem faz**.

### 11.1 Placar de honestidade da própria auditoria

Um agente que só confirma o que já achava não está auditando. O placar:

| O que aconteceu | Quantas vezes |
|-----------------|---------------|
| Achado dos meus próprios agentes que eu **derrubei** ao verificar | 4 |
| Armadilha que a verificação **pegou** (parecia morto, estava vivo) | 2 |

Os 4 derrubados: as duas "falhas de RLS" em `learning_path_items_admin_update` e
`learning_paths_admin_update` (um `WITH CHECK` nulo herda o `USING`, não é
buraco); os itens de menu com `contexts: []` chamados de "código morto"; e o
"vazamento" no POST de `/api/teach/offers`.

O caso dos `contexts: []` merece registro porque quase virou bug: a onda 3 disse
que eram entradas mortas e mandou deletar. Rastreando quem lê `platformNav`,
`platform-header.tsx:98` varre a lista **inteira** para traduzir o título da
página. Apagar teria degradado cinco cabeçalhos para o pedaço da URL, em
português e espanhol. E investigando isso apareceu um bug real que o achado
original **não tinha visto**: `/account/notifications` já estava sem tradução.
Corrigido em `64524d8`.

### 11.2 Advisor de performance: 243 avisos, 5 acionáveis

| Tipo | Qtd | Decisão |
|------|-----|---------|
| `unindexed_foreign_keys` | 5 | **Corrigido** — `3240a60` |
| `unused_index` | 71 | **Ignorar** — banco sem tráfego; todo índice parece inútil antes do lançamento |
| `multiple_permissive_policies` | 166 | **Não mexer** — decisão ㉕ abaixo |
| `auth_db_connections_absolute` | 1 | Informativo |

Os 166 se concentram em `course_events` (24), `community_comments` (18) e
`courses` (18). O custo em tabela quase vazia é irrelevante; consolidar política
de RLS é refatoração de segurança, e eu não faço isso com o dono dormindo.

### 11.3 Estado das migrations (dois itens fechados)

Provei o estado real sondando **objetos do schema**, não o nome no ledger — o
ledger está dessincronizado desde a virada para direct charges.

| Objeto | Existe? | Fecha |
|--------|---------|-------|
| `featured_slots_for_plan`, `set_own_course_featured` | sim | sub-plano 1 |
| `certificates.sponsor_logo_url` | sim | sub-plano 2 |
| `public_profiles`, `public_storefront_projection` | sim | sub-plano 3 |
| `certificates.hide_platform_brand` | sim | **sub-plano 4 — bloqueio ⑰ resolvido** |

⑰ ("rodar `20260808150000_whitelabel_platform_brand.sql`") **sai da lista de
bloqueios**: a coluna que só essa migration cria está no banco.

### 11.4 O que ainda dá para eu fazer sozinho

| # | Item | Prioridade | Tamanho |
|---|------|-----------|---------|
| A1 | `enforce_rate_limit` — erro de um a mais na contagem da janela | P2 | 15 min |
| A2 | Checkout de assinatura — plano duplicado depende de um fallback do Stripe em vez de barrar antes | P2 | 30 min |
| A3 | 31 símbolos mortos, já provados sem nenhum chamador | P3 | 30 min |
| A4 | Minha própria passada de design + o diff "onde eu e o Codex concordamos/divergimos" | P1 (Bloco C) | 2 h |

### 11.5 CSP — por que ainda está em Report-Only

A política de segurança de conteúdo (a regra que diz ao navegador de onde ele
pode carregar script) está em modo "só avisa", com `unsafe-inline` e
`unsafe-eval` liberados. Ligar de verdade sem nonce por requisição derruba o
Next inteiro em produção. É trabalho de meio dia com risco de tela branca no
site que já está no ar — **não é coisa de fazer sem alguém acordado para dar
rollback**. Fica como P2 agendado, não como pendência esquecida.

### 11.6 Decisões que só o Patrick fecha

| # | Decisão | Custo de não decidir |
|---|---------|---------------------|
| ㉒ | Cupom pode ter uso ilimitado? | Nenhum hoje — o padrão atual é limite obrigatório |
| ㉓ | Aprovar 3 limpezas destrutivas de banco (`drop table platform_config`; 2 colunas de `payout_ledger`; 1 de `checkout_locks`) | Nenhum — só lixo ocupando o schema |
| ㉔ | `/how-it-works`: apagar ou linkar no rodapé? | Nenhum — hoje não está indexada nem linkada |
| ㉕ | Consolidar as 166 políticas permissivas duplicadas | Nenhum agora; vira custo real quando as tabelas encherem |

Nenhuma dessas quatro sangra. Todas podem esperar ele acordar.

---

## 12. A4 — Auditoria cruzada: eu × Codex (2026-08-09)

Rodei a auditoria de design duas vezes, por dois motores independentes: eu, lendo
o código de dentro para fora, e o Codex (`codex exec`), olhando layout e fluxo. O
valor não está em nenhum dos dois relatórios sozinho — está em **onde os dois
bateram** (aí a confiança sobe) e **onde só um viu** (aí um dos dois estava
distraído).

### 12.1 Os dois viram — confiança alta, entra no plano sem discussão

| # | Achado | Onde |
|---|--------|------|
| 1 | `/learn` não tem catálogo de curso que o aluno **não** comprou, nem cadeado | `learn-dashboard.tsx` |
| 2 | Não existe botão de aula anterior / próxima aula em lugar nenhum | `enrolled-course-workspace.tsx` |
| 3 | Botão "marcar como concluída" duplicado na mesma tela | `:611`, `:895`, `:1407` |
| 4 | Alvo de toque abaixo de 44px no celular | `globals.css:4478` — **os dois citaram a mesma linha** |
| 5 | Dois editores de curso concorrentes na área do professor | `course-builder-studio` × `teacher-course-studio` |
| 6 | "Revisar e publicar" é botão terciário, abaixo de "Salvar rascunho" | `teacher-course-studio.tsx:405` |
| 7 | Design sem sistema: 5 famílias de botão, 14 tipos de card, 10 tamanhos de título | global |

O item 4 é o mais forte do relatório inteiro: duas auditorias cegas uma à outra
apontaram o mesmo número de linha. **Já corrigido nesta sessão.**

### 12.2 Só o Codex viu — vale adotar

| Achado | Por que importa |
|--------|-----------------|
| Curso de demonstração leva o aluno logado de volta para `/courses` em vez do checkout | É o item ⑨ dele, com a causa técnica encontrada |
| A área do aluno usa **duas cascas diferentes**: `PlatformShell` em `/learn`, `MemberAreaShell` na aula, e `PlatformShell` de novo na comunidade | O aluno "troca de site" no meio da navegação |
| `LearningPathsRows` devolve `null` e engole erro de carregamento | **O componente de fileira estilo Netflix já existe** — o sub-plano 10 tem base pronta, não parte do zero |
| Estado de carregamento é texto puro, não esqueleto | Diferença visível entre "profissional" e "protótipo" |
| Campos do construtor sem rótulo e com foco fraco | Acessibilidade |

### 12.3 Só eu vi — o Codex passou batido

| Achado | Por que ele não viu |
|--------|--------------------|
| **Não existe lista de alunos/compradores** para o professor | Ele listou `/teach/members` como "funcional" duas vezes, com descrições diferentes — não abriu o arquivo |
| **Não existe nenhuma tela de reembolso** | Ele viu o redirecionamento e chamou de "sobra de código", não de buraco de produto |
| Vendas travadas em 50 registros, sem paginação nem exportação | `sale-list.tsx:104` |
| Sino de notificação some abaixo de 640px | `platform-header.tsx:52` |
| 34 lugares pintam erro na cor dourada da marca em vez de `--color-danger` | Erro que não parece erro |
| Não existe modal de detalhe do curso em lugar nenhum | É requisito direto do sub-plano 10 |
| Progresso é um booleano por aula — não dá para retomar no minuto certo | |

### 12.4 Onde o Codex errou — e por que valeu conferir

A seção 10 do relatório dele ("sobras da remoção de afiliado/co-produção")
**errou nos quatro itens**. Conferi um por um antes de mexer em qualquer coisa:

| Alegação do Codex | Realidade |
|-------------------|-----------|
| `payment-split` ainda é importado em dois arquivos | **Falso.** `src/domain/payment-split.ts` não existe mais. As duas linhas citadas importam `DEFAULT_PLATFORM_FEE_BPS`, que é a **nossa** taxa de plataforma — coisa completamente diferente de rateio |
| Comentário em `site.ts:233` é sobra | É documentação deliberada do *porquê* da remoção |
| Comentário em `course-commerce-panels.tsx:35` é sobra | Idem |
| `/teach/refunds` ainda aparece no menu | **Falso.** `site.ts:201` diz explicitamente que não há entrada no menu; a rota sobrevive só para link antigo salvo |

Se eu tivesse agido pela primeira alegação, teria "consertado" código que está
certo e mexido na regra de dinheiro — justamente a que não pode ser tocada. **A
varredura de sobras da política de pagamento está limpa dos dois lados.** O único
proveito real da seção 10 foi apontar para a falta de tela de reembolso, que eu
já tinha achado sozinho.

### 12.5 Achado 4.1 — sinalizado, não consertado (com motivo)

`lesson-content.ts:42-46` puxa `select("*")` de todas as aulas do curso sem filtro
de aula nem de liberação. Um aluno matriculado recebe no navegador o texto e o
link externo de **todas** as aulas, inclusive as que o gotejamento ainda não
abriu. O vídeo já está fechado no servidor (`65be718`); isto aqui é o texto.

**Decisão: sinalizar, não refatorar agora.** O banco tem **1 curso em rascunho e
zero publicados** — não existe aluno pagante, logo não existe exposição real
hoje. Consertar significa mudar o contrato de uma inscrição em tempo real e
mexer em `enrolled-course-workspace.tsx` — não é coisa de fazer às 7h da manhã
com o dono dormindo.

Duas saídas quando for a hora:

- **(a) Rota de servidor por aula, reusando `getLessonUnlockState`** — recomendada.
  Mesma função de regra que já protege o vídeo. Uma implementação, um lugar.
- **(b) Portar a regra de gotejamento para RLS no banco** — significa escrever a
  mesma regra de 5 estratégias uma segunda vez, em outra linguagem. É exatamente
  a armadilha "certo em quatro lugares, diferente no quinto".
