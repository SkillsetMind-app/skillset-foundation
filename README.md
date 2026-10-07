# SkillsetMind

## In English

SkillsetMind is an online course platform for psychologists and personal-development
professionals: creators build and sell courses, learners buy and watch them on the same site.
- **Four areas:** visitor (`src/app/courses`), student (`src/app/learn`), teacher (`src/app/teach`) and operations (`src/app/ops`).
- **Stack:** Next.js on Vercel, Supabase (Postgres database and login), Stripe Connect with direct charges, Bunny Stream for video, GitHub Actions for checks.
- **Run locally:** `npm ci`, copy `.env.example` to `.env.local` with test values, `npm run dev`.
- **Shipping:** branch → pull request → review → 5 required checks → merge → Vercel deploys `main`. Database migrations are applied by hand, never by merging.
- **Docs:** `docs/COMO-TRABALHAR.md` (onboarding), `docs/ARQUITETURA.md` (system map), `docs/README.md` (index). This file and the first two open with an English summary; the rest is in Portuguese.
- This repository is public: no secrets, customer data or business strategy here.

---

A SkillsetMind é uma plataforma de cursos on-line para psicólogos e
profissionais de desenvolvimento pessoal: quem ensina monta e vende os cursos,
quem aprende compra e assiste, tudo no mesmo site (https://www.skillsetmind.com).

Este repositório guarda o código do site inteiro. Ele é **público**: não coloque
aqui chave, senha, dado de cliente nem estratégia da empresa.

## As 4 áreas do site

| Área | Para quem | Onde fica o código |
|---|---|---|
| Visitante | Quem ainda não entrou: página inicial, catálogo de cursos, página de cada professor, preços, ajuda, termos | `src/app/page.tsx`, `src/app/courses`, `src/app/instructors`, `src/app/legal` |
| Aluno | Quem comprou: sala de aula, comunidade, certificados, mensagens | `src/app/learn` |
| Professor | Quem vende: criação de curso, vitrine, vendas, alunos, cupons, relatórios | `src/app/teach` |
| Operações | A equipe da plataforma: usuários, papéis, fila de pendências | `src/app/ops` |

A conta de cada pessoa (perfil, segurança, planos, pagamentos) fica em
`src/app/account` e serve às quatro áreas. O mapa completo está em
`docs/ARQUITETURA.md`.

## As peças principais

- **Next.js** — o "motor" do site: monta as páginas e roda as rotas do servidor (os endereços que o site chama por trás, em `src/app/api`).
- **Supabase** — guarda o banco de dados (Postgres, onde ficam cursos, alunos, pedidos) e cuida do login.
- **Stripe Connect** — recebe os pagamentos; o dinheiro da venda cai direto na conta Stripe do professor.
- **Bunny** — hospeda e entrega os vídeos das aulas.
- **Vercel** — hospeda o site: pega o código do GitHub, monta e publica.
- **GitHub Actions** — robôs que conferem cada mudança automaticamente antes de ela entrar.

## Como rodar no seu computador

Você precisa do Node.js (o programa que roda JavaScript fora do navegador) na
versão do arquivo `.nvmrc`, e de acesso a um projeto Supabase de teste.

1. Instale as dependências (as bibliotecas que o projeto usa), exatamente como o CI: `npm ci`
2. Copie `.env.example` para `.env.local` e preencha os valores. O `.env.local`
   nunca vai para o git. Os nomes mais importantes:
   - banco e login: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - pagamentos: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`
   - vídeo: `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_TOKEN_KEY`, `NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID`
   - e-mail: `RESEND_API_KEY`
   - tarefas agendadas: `CRON_SECRET`

   A lista completa, com o que cada um faz, está no próprio `.env.example`.
   Regra: valor secreto **nunca** leva o prefixo `NEXT_PUBLIC_` (esse prefixo
   manda o valor para o navegador de qualquer visitante).
3. Suba o site: `npm run dev` e abra http://localhost:3000.

Comandos de conferência (os mesmos que o robô roda):

| Comando | O que faz |
|---|---|
| `npm run lint` | procura erros de estilo e descuidos no código |
| `npx tsc --noEmit` | confere os tipos (se cada dado tem o formato esperado) |
| `npm test` | roda os testes automáticos (Vitest) |
| `npm run build` | monta o site como em produção |
| `npm run test:db` | roda os testes de segurança do banco num banco descartável (veja `scripts/build-test-db.sh`; nunca aponte para produção) |

Em máquina com pouca memória, rode **um arquivo de teste por vez**:
`npx vitest run src/app/documentacao-caminhos.test.ts --pool=forks --maxWorkers=1`.

## Como uma mudança chega ao site

1. **Rascunho:** crie uma branch (uma cópia paralela do código) a partir de `main`. Nunca mexa direto na `main`.
2. **Salvar:** faça commits (cada commit é um "salvar" com descrição do que mudou).
3. **Pedido de revisão:** abra um pull request (PR), o pedido para juntar a branch na `main`.
4. **Revisão:** uma pessoa lê a mudança. O Porteiro de PR (uma IA que lê o diff procurando brechas de segurança) comenta um placar no PR; ele avisa, mas não bloqueia.
5. **Conferências automáticas:** o GitHub só deixa juntar se estes 5 checks passarem:
   - `Lint, typecheck, test, build` — estilo, tipos, testes e montagem (`.github/workflows/ci.yml`);
   - `RLS smoke tests (banco efêmero)` — testa as regras de acesso do banco num banco descartável (`.github/workflows/ci.yml`);
   - `Semgrep SAST` — procura padrões de código inseguro (`.github/workflows/security.yml`);
   - `TruffleHog secrets scan` — procura chave ou senha vazada no código (`.github/workflows/security.yml`);
   - `npm audit (high+)` — procura bibliotecas com falha de segurança grave conhecida (`.github/workflows/security.yml`).

   A Vercel também monta uma prévia do site para cada PR.
6. **Juntar:** com tudo verde, o PR é mesclado na `main`.
7. **Publicar:** a Vercel percebe a mudança na `main` e publica sozinha em produção.

Mudança no banco de dados (uma migration) é a exceção: ela não é aplicada
sozinha. Veja "Banco de dados" em `docs/ARQUITETURA.md`.

## Onde está a documentação

- `README.md` — este arquivo: o que é e como trabalhar.
- `docs/COMO-TRABALHAR.md` — guia de entrada para um time novo de desenvolvimento: acessos, ambiente, fluxo, convenções, migrations e o que não fazer.
- `docs/ARQUITETURA.md` — o mapa do sistema: onde fica cada parte e como elas se ligam.
- `docs/README.md` — índice de tudo o que existe em `docs/`.
- `AGENTS.md` — regras que já custaram defeito em produção; leitura obrigatória antes de mexer em tela.
- `STRIPE_CHECKLIST.md` — passo a passo para configurar o Stripe.

O teste `src/app/documentacao-caminhos.test.ts` confere que todo caminho citado
entre crases neste README, em `docs/ARQUITETURA.md`, em `docs/README.md` e em
`docs/COMO-TRABALHAR.md` existe de verdade. Se você mover um arquivo, atualize o documento junto.
