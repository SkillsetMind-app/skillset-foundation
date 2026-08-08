# Plano Mestre — Recursos por Plano

**Data:** 2026-08-08
**Status:** em execução (sub-plano 1)

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
| **Minutos de aula ao vivo/mês** | — | 5.000 | 30.000 | 100.000 |
| Armazenamento de vídeo (min) | 60 | 600 | 3.000 | 10.000 |
| Destaques no marketplace | — | 1 | 3 | 5 |
| Cupons ativos | 3 | 20 | 100 | ilimitado |
| Domínio próprio | — | — | 1 | 3 |
| Assentos de equipe | 1 | 2 | 5 | 15 |
| Disparos de e-mail/mês | — | 2.000 | 10.000 | 50.000 |
| Tirar a marca SkillsetMind | não | não | **sim** | **sim** |
| Certificado com logo próprio | não | **sim** | **sim** | **sim** |
| Template de site | não | **sim** | **sim** | **sim** |

### A armadilha dos minutos ao vivo

Minuto ao vivo tem que ser contado em **minuto-espectador**, não minuto de aula. Uma aula de 60 min com 25 alunos gasta 1.500.

Se contássemos minuto de aula, o Pro com 1.200 min e 100 espectadores viraria 120.000 min entregues = **$120 de custo contra uma assinatura de $89**. O plano daria prejuízo com um único professor popular.

Tradução que o professor lê na tela:
- Starter: "cerca de 5 horas de aula ao vivo com 15 alunos"
- Pro: "cerca de 20 horas de aula ao vivo com 25 alunos"
- Plus: "cerca de 40 horas de aula ao vivo com 40 alunos"

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
| **9** | Aula ao vivo | Depende da decisão transmissão vs videoconferência. | a definir |

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
