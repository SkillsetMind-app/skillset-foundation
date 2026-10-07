# Índice da documentação

O que existe em `docs/`, uma linha por item. Para começar, leia o `README.md` da
raiz e depois `docs/ARQUITETURA.md`.

## Para começar

- `docs/COMO-TRABALHAR.md` — guia de entrada para um time novo: acessos, ambiente, fluxo de trabalho, convenções do código, migrations do banco, design system e o que não fazer.

## Como o sistema funciona

- `docs/ARQUITETURA.md` — mapa do sistema: páginas, dados, banco, pagamentos, vídeo, e-mail, tarefas agendadas, traduções, testes e portões de segurança.

## Roteiros de operação

- `docs/first-admin-setup.md` — como criar o primeiro administrador e promover os seguintes.
- `docs/BACKUP.md` — como o backup diário funciona, como configurar e como restaurar.
- `docs/teacher-advisor-setup.md` — como ligar o consultor de IA do professor (variáveis, base de conhecimento, reindexação).
- `docs/operational-account-controls.md` — como suspender, bloquear e restaurar uma conta, e onde o banco garante isso.
- `STRIPE_CHECKLIST.md` (na raiz) — configuração do Stripe campo por campo.

## Design

- `docs/design-system/skillset-design-system/` — o design system: cores, tipografia, botões, cartões e kits de tela.
- `docs/design-v2/DESIGN-SYSTEM-V2.md` — especificação da segunda versão do design (tokens e componentes).
- `docs/design-reference/skillset-design-v2-2/` — protótipos de tela usados como referência visual (não é código de produção).

## Traduções

- `docs/i18n-archive/` — o dicionário em português guardado para quando o site voltar a ter português, com o passo a passo para religar.

## Regras para manter isto vivo

- Documento novo entra neste índice.
- Plano, relatório de sessão, estratégia de negócio, material de investidor e
  achado de segurança **não** entram neste repositório: ele é público.
- O teste `src/app/documentacao-caminhos.test.ts` confere que todo caminho entre
  crases neste índice, no `README.md`, em `docs/ARQUITETURA.md` e em
  `docs/COMO-TRABALHAR.md` existe.
