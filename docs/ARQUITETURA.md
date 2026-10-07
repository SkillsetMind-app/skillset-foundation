# Arquitetura da SkillsetMind

O mapa do sistema: onde fica cada parte e como elas conversam. Escrito para quem
nunca programou e para quem acabou de chegar ao código. Todo caminho entre
crases existe de verdade; o teste `src/app/documentacao-caminhos.test.ts` quebra
se algum deixar de existir.

## Visão de cima

```
Navegador do visitante
   │
   ▼
Vercel (hospedagem) ── roda o Next.js (src/app)
   │        │
   │        ├── Supabase: banco de dados, login e arquivos
   │        ├── Stripe: pagamentos (direto na conta do professor)
   │        ├── Bunny: vídeos das aulas
   │        └── Resend: e-mails
   ▼
GitHub Actions: conferências de cada mudança, tarefas de hora em hora, backup
```

## Pastas principais

| Pasta | O que guarda |
|---|---|
| `src/app` | As páginas (cada pasta vira um endereço do site) e as rotas do servidor em `src/app/api` |
| `src/components` | As peças de tela reaproveitáveis (botões, cartões, menus), separadas por área |
| `src/lib` | O código que conversa com o mundo de fora: banco, Stripe, Bunny, e-mail |
| `src/domain` | As regras do negócio em código puro, sem banco nem internet (por isso fáceis de testar) |
| `src/data` | Conteúdo fixo: textos traduzidos, planos, perguntas da ajuda |
| `supabase` | A estrutura do banco e os testes de segurança dele |
| `scripts` | Ferramentas de linha de comando: backup, testes do banco, configuração do Stripe |
| `.github` | Os robôs do GitHub Actions |

## Páginas por área (`src/app`)

**Visitante** (não precisa de login):
`src/app/page.tsx` (início), `src/app/courses` (catálogo e página de cada curso),
`src/app/instructors` (página pública de cada professor), `src/app/pricing`,
`src/app/how-it-works`, `src/app/for-creators`, `src/app/fees-and-payouts`,
`src/app/help`, `src/app/support`, `src/app/promise`, `src/app/trust`,
`src/app/refund-policy`, `src/app/legal` (termos e privacidade) e
`src/app/verify` (qualquer pessoa confere se um certificado é verdadeiro).

**Entrada e cadastro:** `src/app/login`, `src/app/signup`,
`src/app/forgot-password`, `src/app/reset-password`, `src/app/auth` (formulário
de entrada e retorno dos links de e-mail), `src/app/onboarding`, `src/app/welcome` e
`src/app/invitations` (convites).

**Aluno** — `src/app/learn`: sala de aula de cada curso
(`src/app/learn/courses/[slug]`), comunidade, certificados, eventos, mensagens e
lista de desejos. O pagamento de um curso começa em
`src/app/courses/[slug]/checkout`.

**Professor** — `src/app/teach`: criador de curso (`src/app/teach/builder`),
vitrine (`src/app/teach/storefront`), vendas, alunos, cupons, assinaturas,
reembolsos, relatórios, equipe, mídia e verificação.

**Operações** — `src/app/ops`: painel da equipe da plataforma e ficha de cada
usuário (`src/app/ops/users`). Só abre para quem tem papel de operação e entrou
com o segundo fator (veja `docs/first-admin-setup.md`).

**Conta** — `src/app/account`: perfil, segurança, e-mail, notificações, plano e
pagamentos. Serve às quatro áreas.

**Antes de tudo** — `src/proxy.ts` roda em cada pedido antes da página: decide
para onde vai um domínio próprio de professor, aplica a política de segurança
de conteúdo (CSP, a lista do que o navegador pode carregar) e filtra países nas
portas sensíveis.

## Peças de tela por área (`src/components`)

| Pasta | Área |
|---|---|
| `src/components/site` | Visitante: cabeçalho, rodapé, seções da página inicial |
| `src/components/courses`, `src/components/instructors` | Catálogo e páginas públicas |
| `src/components/auth` | Login, cadastro, CAPTCHA |
| `src/components/learn` | Aluno: sala de aula, lista de aulas, comunidade |
| `src/components/teacher` | Professor: criador de curso, vendas, vitrine, consultor de IA |
| `src/components/admin` | Operações: painel, papéis, convites |
| `src/components/account` | Conta: plano, segurança, segundo fator |
| `src/components/platform` | A moldura das áreas logadas: menu lateral, barra do topo |
| `src/components/ui`, `src/components/shared` | Peças básicas usadas em todo lugar |

## Camada de dados

- `src/lib/supabase/client.ts` cria a conexão com o Supabase **no navegador**;
  `src/lib/supabase/server.ts`, **no servidor** com a sessão de quem está logado;
  `src/lib/supabase/admin.ts`, no servidor com a chave de serviço (que passa por
  cima das regras de acesso — só para pagamentos, webhooks e tarefas agendadas).
- `src/lib/data` reúne as funções que leem e gravam cada assunto (pedidos,
  matrículas, cursos, notificações...). As que só rodam no servidor ficam em
  `src/lib/data/server`.
- `src/domain` tem as regras puras: quem pode ver qual aula, quanto custa, quando
  uma aula libera. As telas e as rotas chamam essas regras em vez de repetir a
  lógica.
- `src/lib/supabase/database.types.ts` descreve o formato de cada tabela do
  banco, para o código saber que dado esperar.

## Banco de dados (`supabase`)

- `supabase/migrations` — cada migration é um arquivo SQL que muda a estrutura do
  banco (cria tabela, coluna, regra). A data no nome define a ordem.
- **RLS** (row-level security, "segurança por linha") é uma regra dentro do
  próprio banco que decide, registro por registro, quem pode ler ou alterar cada
  linha; assim, mesmo que uma tela erre, o banco não entrega o curso de um
  professor a outro.
- `supabase/tests` — testes de fumaça das regras de RLS. O CI monta um banco
  descartável com `scripts/build-test-db.sh` e roda os testes com
  `scripts/run-supabase-tests.mjs`.
- `supabase/schema/remote_schema_2026-07-21.sql` — retrato completo do banco em
  21/07/2026. As migrations mais antigas que ele não se reaplicam do zero; a
  verdade reproduzível é "retrato + migrations posteriores" (o porquê está em
  `supabase/SCHEMA_BASELINE_REPORT.md`).
- `supabase/templates` — os modelos dos e-mails de login (confirmação, troca de
  senha, convite).
- **Como uma migration chega à produção:** não há aplicação automática. Mesclar
  o PR não muda o banco: quem tem acesso aplica o arquivo à mão no banco de
  produção (pelo painel do Supabase ou por linha de comando).

## Login e papéis

O login é do Supabase Auth (`src/lib/auth/supabase-auth.ts`). Cada usuário tem
uma lista de papéis (`student`, `teacher`, `admin`, `ops`, `support`,
`moderator`); o que cada papel pode fazer está em `src/lib/permissions/index.ts`,
e o banco confere de novo por conta própria. Papéis de equipe só valem com o
segundo fator (código do aplicativo autenticador). Outras defesas: senha vazada é
recusada (`src/app/api/auth/pwned-check`), CAPTCHA (o teste "você é humano?")
nas telas de entrada (`src/components/auth/turnstile-widget.tsx`) e limite de tentativas
(`src/lib/supabase/rate-limit.ts`).

## Pagamentos e webhooks

- **Modelo de cobrança direta:** o comprador paga direto na conta Stripe do
  professor. O professor é o vendedor oficial; a comissão da plataforma sai
  automática na própria cobrança, e a plataforma nunca segura dinheiro de
  terceiro. O checkout de curso está em `src/app/api/payments/checkout/route.ts`.
- **Conta do professor no Stripe:** criação, cadastro e atualização em
  `src/app/api/payments/connect`.
- **Plano do professor** (assinatura mensal): `src/app/api/payments/billing`.
  Os planos e o que cada um libera estão em `src/data/plans.ts` e
  `src/domain/entitlements.ts`. A ativação da vitrine passa por
  `src/app/api/payments/activation`.
- **Reembolsos:** `src/app/api/payments/refunds`. **Cancelar assinatura de curso:**
  `src/app/api/payments/course-subscription`.
- **Taxas e regras de valor:** `src/lib/payments/rules.ts`.
- **Webhook** (o aviso que o Stripe manda ao site quando algo acontece: venda
  paga, reembolso, disputa): `src/app/api/webhooks/stripe/route.ts`. Ele confere
  a assinatura do aviso contra dois segredos (eventos da plataforma e eventos das
  contas dos professores) e só então libera o acesso ao curso. Configuração
  passo a passo: `STRIPE_CHECKLIST.md` na raiz.

## Vídeo

- Os vídeos ficam na **Bunny Stream** (serviço de hospedagem de vídeo).
- Envio: o servidor cria o vídeo e devolve uma assinatura de curta duração
  (`src/app/api/teach/video/create/route.ts`); o navegador do professor manda o
  arquivo direto para a Bunny em pedaços, que retomam de onde pararam se a
  internet cair. O andamento é consultado em `src/app/api/teach/video/status`.
- Exibição: antes de tocar, `src/app/api/courses/video-token/route.ts` confere se
  a pessoa tem direito à aula e devolve um link assinado que expira.
- O código que fala com a Bunny está em `src/lib/bunny/server.ts`.
- Capas e miniaturas ficam no armazenamento de arquivos do Supabase, num espaço
  público; materiais de apoio do curso ficam num espaço privado, lido por links
  temporários (`src/lib/data/course-assets.ts`).

## E-mail e notificações

- **E-mails de login** (confirmar cadastro, trocar senha): enviados pelo
  Supabase com os modelos de `supabase/templates`, gerados por
  `scripts/build-email-templates.mjs`.
- **E-mails do produto** pela Resend (serviço de envio de e-mail): acesso
  liberado após a compra (`src/lib/payments/server/purchase-access-email.ts`),
  lembrete de confirmar o e-mail (`src/app/api/cron/confirmation-reminder`) e
  resumo de notificações (`src/app/api/cron/notification-digest`).
- **Notificações dentro do site:** `src/lib/data/notifications.ts`; chegam na
  hora, sem recarregar a página.
- **Alertas para a equipe:** `src/lib/ops/alert.ts` manda o aviso para um canal
  privado (o endereço fica numa variável de ambiente, nunca no código).

## Tarefas agendadas

| O quê | Quando | Onde está marcado |
|---|---|---|
| Reindexar a base de conhecimento do consultor de IA (`src/app/api/cron/advisor-knowledge`) | todo dia, 07:00 UTC | `vercel.json` |
| Pagamentos travados no Stripe, fila de pendências da equipe e se o site está no ar (`src/app/api/cron/stripe-attention`, `src/app/api/cron/ops-inbox`) | de hora em hora | `.github/workflows/stripe-attention.yml` |
| Lembrete de confirmar e-mail e resumo de notificações | de hora em hora | `.github/workflows/stripe-attention.yml` |
| Backup criptografado do banco e dos arquivos | todo dia, 04:10 UTC | `.github/workflows/backup.yml` (detalhes em `docs/BACKUP.md`) |
| Varredura de segurança completa | todo domingo, 06:00 UTC | `.github/workflows/security.yml` |

As rotas `src/app/api/cron` só respondem a quem mostra o `CRON_SECRET`
(`src/lib/cron/authorized.ts`). Ficam no GitHub Actions as que rodam de hora em
hora porque o plano atual da Vercel só agenda uma vez por dia.

## Assistentes de IA

- **Ajuda pública** (`src/app/api/assistant/route.ts`): responde visitantes com
  base no mesmo conteúdo da página de ajuda (`src/data/help-faq.ts`).
- **Consultor do professor** (`src/app/api/teach/advisor/route.ts`): ajuda quem
  vende, com memória da conversa. Montagem e variáveis em
  `docs/teacher-advisor-setup.md`.

## Traduções

- O site fala inglês e espanhol. Os textos ficam em `src/data/i18n/en.json` e
  `src/data/i18n/es.json`; os dois precisam ter as mesmas chaves e os mesmos
  marcadores (`src/lib/i18n/dictionary-parity.test.ts` confere).
- O idioma escolhido fica guardado num cookie (um lembrete salvo no navegador),
  e não no endereço da página (`src/lib/i18n/config.ts`).
- `src/data/i18n/regulated-wording.test.ts` barra palavras de profissão
  regulamentada nos textos (regra completa em `AGENTS.md`).
- O português foi guardado para o futuro em `docs/i18n-archive/pt-br.json`.

## Testes

- **Vitest** (a ferramenta de testes automáticos) roda todo arquivo
  `*.test.ts` ou `*.test.tsx` dentro de `src`. Comando: `npm test`.
- Em máquina com pouca memória, rode **um arquivo por vez**, num processo só:
  `npx vitest run caminho/do/arquivo.test.ts --pool=forks --maxWorkers=1`.
- Os testes rodam sem navegador de verdade, então não enxergam layout. Algo que
  "cabe na tela" precisa ser conferido num navegador real (veja `AGENTS.md`).
- Testes do banco: `npm run test:db`, sempre num banco descartável.

## Portões de segurança

Cada PR passa por estes portões antes de poder entrar na `main`:

| Portão | O que faz | Onde |
|---|---|---|
| Porteiro de PR | Uma IA lê o diff e procura brechas de lógica; comenta só o placar no PR (o detalhe vai para um canal privado, porque o repositório é público). Avisa, não bloqueia. Os testes dele rodam no check obrigatório | `.github/workflows/porteiro.yml`, `scripts/porteiro.py`, `scripts/test_porteiro.py` |
| Semgrep | Procura padrões conhecidos de código inseguro em `src` | `.github/workflows/security.yml` |
| TruffleHog | Procura chave ou senha vazada, inclusive no histórico | `.github/workflows/security.yml` |
| Testes de RLS | Provam, num banco descartável, que as regras de acesso seguram | `.github/workflows/ci.yml`, `supabase/tests` |
| npm audit | Barra biblioteca com falha de segurança alta ou crítica | `.github/workflows/security.yml` |

Além deles: o Dependabot propõe atualização de bibliotecas
(`.github/dependabot.yml`), e testes guardam as regras do banco dentro do
próprio Vitest (`src/lib/supabase/rls-policy-guards.test.ts`,
`src/lib/supabase/rpc-definition-guards.test.ts`) e a automação do repositório
(`src/app/repo-automation.test.ts`).

## Domínio próprio do professor

Um professor pode ligar o próprio domínio à vitrine. O pedido entra por
`src/app/api/teach/domains`, o domínio é registrado na Vercel
(`src/lib/domains`), e `src/proxy.ts` usa `src/domain/host-routing.ts` para
mostrar a vitrine certa quando alguém chega por esse endereço.

## Medição de uso

PostHog (`src/lib/posthog`) e Vercel Analytics registram uso das páginas, para
saber o que as pessoas fazem no site. O PostHog respeita a escolha do aviso de
cookies: quem recusa não é medido.
