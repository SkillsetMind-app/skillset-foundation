# Como trabalhar neste repositório

## In English

Onboarding guide for a developer team joining SkillsetMind.
- **Accesses:** GitHub, Vercel, Supabase, Stripe (test mode first), Bunny Stream and Resend.
- **Setup:** Node from `.nvmrc`, `npm ci`, copy `.env.example` to `.env.local` with test values, `npm run dev`.
- **Flow:** branch from `main` → pull request → review → 5 required checks → squash merge → Vercel deploys `main`.
- **Conventions:** commits and new code comments in Portuguese; every UI string lives in `src/data/i18n` (EN and ES); motion only inside `@media (prefers-reduced-motion: no-preference)`, animating `transform`/`opacity` only; visible focus and real ARIA.
- **Tests:** Vitest; on low-memory machines run one test file per process.
- **Database:** a new migration file per change, never edit an applied one; each has a smoke test; production gets it by hand, never by merging.
- **Never:** secrets in code, reading or committing `.env` files with real values, force-pushing to `main`.

Guia de entrada para quem vai programar na SkillsetMind. Leia antes também o
`README.md` (o que é o produto), o `docs/ARQUITETURA.md` (onde fica cada parte) e
o `AGENTS.md` (regras que já custaram defeito em produção).

## 1. Acessos de que você vai precisar

Peça a quem coordena o time. Só os nomes aqui; nenhum valor de chave entra no
repositório.

| Serviço | Para quê |
|---|---|
| GitHub | Ler e escrever no repositório, abrir PRs, ver os checks |
| Vercel | Ver as prévias de cada PR, os logs e as variáveis de ambiente do site |
| Supabase | Banco de dados, login e arquivos. Para o dia a dia, um projeto **de teste**; produção só para quem aplica migration |
| Stripe | Pagamentos, sempre começando no **modo de teste** |
| Bunny | Envio e exibição de vídeo (biblioteca do Bunny Stream) |
| Resend | Envio dos e-mails do produto |

Nem todo mundo precisa de todos. Quem só mexe em tela vive com GitHub, Vercel e um
projeto Supabase de teste.

## 2. Montar o ambiente no seu computador

1. Instale o Git e o Node.js na versão do arquivo `.nvmrc` (o Node é o programa
   que roda JavaScript fora do navegador).
2. Baixe o código:
   `git clone https://github.com/SkillsetMind-app/skillset-foundation.git`
3. Instale as dependências exatamente como o CI: `npm ci`.
4. Copie `.env.example` para `.env.local` e preencha com valores **de teste** que
   o time te passar. O `.env.local` nunca vai para o git. Nunca use chave de
   produção na sua máquina.
5. Suba o site: `npm run dev` e abra http://localhost:3000.
6. Confira que está tudo certo: `npm run lint` e `npx tsc --noEmit`.
7. Para os testes do banco, deixe o CI rodar. Se precisar rodar local, siga os
   passos do job `rls` em `.github/workflows/ci.yml`: ele sobe um banco
   descartável e o monta com `scripts/build-test-db.sh`. Nunca aponte esses
   testes para produção: eles escrevem no banco.

## 3. Como o trabalho anda

1. **Branch** (uma cópia paralela do código) a partir de `main`, com nome
   `tipo/assunto`: `feat/` para novidade, `fix/` para conserto, `perf/`,
   `chore/` para manutenção, `docs/` para documentação. Exemplo do histórico:
   `fix/compra-sem-beco`.
2. **Commits** pequenos, cada um com uma descrição clara do que mudou.
3. **Pull request** contra `main`, com descrição em português: o que muda, por
   quê, e como foi testado.
4. **Revisão:** uma pessoa lê. O Porteiro de PR (`.github/workflows/porteiro.yml`)
   comenta um placar de segurança; ele avisa, não bloqueia.
5. **Os 5 checks obrigatórios** precisam ficar verdes: `Lint, typecheck, test,
   build` e `RLS smoke tests (banco efêmero)` (em `.github/workflows/ci.yml`);
   `Semgrep SAST`, `TruffleHog secrets scan` e `npm audit (high+)` (em
   `.github/workflows/security.yml`).
6. **Merge:** o histórico da `main` usa squash (o PR vira um commit só, com o
   número do PR no título).
7. **Publicação:** a Vercel publica a `main` sozinha. Cada PR ganha uma prévia
   antes disso.

A `main` é protegida: não aceita commit direto, nem force-push, nem ser apagada.

## 4. Convenções do código (conferidas no repositório)

### Idioma
- Commits, títulos de PR e comentários novos em **português**. Há comentários
  antigos em inglês; não precisa traduzir o que não está mexendo.
- Comentário explica o **porquê** (o defeito que evita, a regra de negócio), não
  repete o que o código diz.

### Textos da tela
- Todo texto que o usuário vê sai dos dicionários `src/data/i18n/en.json` e
  `src/data/i18n/es.json`; nada de frase escrita direto no componente.
- No navegador, use `useTranslation()` de
  `src/components/i18n/i18n-provider.tsx`; no servidor, `getServerTranslation()`
  de `src/lib/i18n/server.ts`.
- Chave nova entra nos dois idiomas, com os mesmos marcadores (`{name}`):
  `src/lib/i18n/dictionary-parity.test.ts` barra a diferença.
- Palavras de profissão regulamentada têm regra própria (veja `AGENTS.md`);
  `src/data/i18n/regulated-wording.test.ts` barra o que escapar.

### Movimento
- Toda animação mora dentro de `@media (prefers-reduced-motion: no-preference)`
  em `src/app/globals.css`, para quem pediu menos movimento no sistema não ver
  nada se mexer.
- As animações só mexem em `transform` e `opacity` (são as propriedades que o
  navegador anima sem refazer o layout). A única exceção aceita é o traço de um
  ícone que se desenha.
- `src/app/onda-d-motion.test.ts` e `src/app/classroom-motion.test.ts` conferem
  essas regras.

### Acessibilidade
- Foco visível: a regra global em `src/app/globals.css` desenha um anel em
  botões e links focados pelo teclado. Não esconda com `outline-none` sem pôr
  outro indicador no lugar.
- Botão é `button`, link é `a`. Ícone sem texto leva `aria-label`; menu que abre
  e fecha usa `aria-expanded`; aviso que aparece sozinho usa `aria-live`.
- Janelas sobrepostas prendem o foco dentro delas
  (`src/lib/a11y/use-modal-focus.ts`) e cabem na tela (regra completa em
  `AGENTS.md`; `src/app/dialog-viewport-fit.test.tsx` confere).
- Títulos em ordem, sem pular nível (`src/app/learn/heading-levels.test.tsx`).
- Campo de formulário com fonte de pelo menos 16px, senão o iPhone dá zoom
  (`src/app/mobile-field-zoom.test.ts`).

### Testes
- Vitest, com arquivos `*.test.ts` ou `*.test.tsx` ao lado do código, dentro de
  `src`.
- Mudou uma regra? Deixe um teste que quebra se ela voltar a falhar.
- Em máquina com pouca memória, rode **um arquivo por processo**:
  `npx vitest run caminho/do/arquivo.test.ts --pool=forks --maxWorkers=1`.
  O CI roda a suíte inteira.
- Os testes não têm navegador de verdade, então não veem layout. O que precisa
  caber na tela se confere num navegador real.

## 5. Migrations do banco, com segurança

Uma migration é um arquivo SQL que muda a estrutura do banco.

**Como escrever:**
- Arquivo novo em `supabase/migrations`, com nome `AAAAMMDDHHMMSS_assunto.sql`
  (a data no nome define a ordem). Comece com um comentário explicando o porquê.
- **Nunca edite uma migration que já foi aplicada.** Para mudar uma função, crie
  outro arquivo com `create or replace`; a definição mais recente vale.
- Tabela nova liga a RLS (a regra do banco que decide quem lê e altera cada
  linha) e ganha suas políticas no mesmo arquivo.
- Função `security definer` (que roda com permissão do dono, acima da RLS) leva
  `set search_path = public, pg_temp` e tira o acesso de quem não deve chamá-la
  (`revoke execute ... from public, anon, authenticated`).
- Escreva o teste de fumaça com o mesmo nome e o final `_smoke.sql` em
  `supabase/tests`, como quase toda migration recente tem, e sempre que a
  mudança mexer em acesso ou em dinheiro. Ele roda no check
  `RLS smoke tests (banco efêmero)`.
- Mudou o formato de uma tabela? Atualize `src/lib/supabase/database.types.ts`.
- Guardas que leem o SQL em todo PR: `src/lib/supabase/rls-policy-guards.test.ts`
  e `src/lib/supabase/rpc-definition-guards.test.ts`.

**Como aplicar:**
- Mesclar o PR **não** muda o banco. A migration é aplicada à mão em produção
  por quem tem esse acesso, pelo painel do Supabase ou por linha de comando.
- O time marca no título os PRs que trazem migration (o histórico usa o
  prefixo `[PC aplica migration]`), para ninguém esquecer de aplicar.
- Aplique primeiro num projeto de teste, confira, depois produção. Dentro de uma
  transação (`begin` ... `commit`), para que um erro no meio não deixe o banco
  pela metade.

## 6. Onde está o design system

- `docs/design-system/skillset-design-system/` — cores, tipografia, botões,
  cartões e kits de tela, com prévias em HTML.
- `src/app/globals.css` — os valores de verdade (as variáveis `--color-*`,
  espaçamentos, movimento) que o site usa.
- `src/components/ui` — as peças básicas já prontas; use antes de criar outra.
- `docs/design-v2/DESIGN-SYSTEM-V2.md` — a especificação da segunda versão.
- `src/data/brand.ts` — nome, marca e logos.

## 7. O que não fazer

- **Segredo no código:** nunca. Chave de servidor não leva o prefixo
  `NEXT_PUBLIC_` (esse prefixo manda o valor para o navegador de qualquer
  visitante). O check do TruffleHog procura chave vazada inclusive no histórico.
- **Arquivos `.env`:** nunca leia em voz alta, cole em chat, imprima em log ou
  faça commit de um `.env` com valor real. O `.env.local` é ignorado pelo git; o
  `.env.production` só guarda valores públicos.
- **Force-push na `main`** ou commit direto nela: não.
- **Editar migration já aplicada:** não; escreva outra.
- **Rodar testes de banco contra produção:** não.
- **Plano, anotação de sessão, estratégia de negócio, material de investidor ou
  achado de segurança no repositório:** não. Ele é público.
