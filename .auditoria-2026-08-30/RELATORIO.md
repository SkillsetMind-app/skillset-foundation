# Auditoria da plataforma SkillsetMind — 30/08/2026

**Escopo:** 520 arquivos, ~95.000 linhas em `src/`, 55 migrations, o banco de produção ao vivo, e o CI.
**Método:** 102 agentes, 2.121 chamadas de ferramenta, 19,5 milhões de tokens, 68 minutos, zero erros — em 7 dimensões independentes, mais uma passada de regressão sobre os 9 bugs abertos de 26/08, mais auditoria direta do banco de produção. Cada achado passou por céticos com lentes diferentes (reproduz / procura a proteção que faltou / confere a âncora no código). **40 achados brutos → 31 confirmados, 9 derrubados.**

> **O `/graphify` não foi usado, de propósito.** O grafo deste repositório tem 2.310 nós e **zero arestas** — não responde nada sobre relação entre arquivos — e é de 20/08, anterior aos PRs #105, #106 e #107. Usá-lo teria custado tempo e devolvido uma lista de arquivos desatualizada.

---

## O resultado em uma linha

**8 dos 9 bugs de 26/08 continuam vivos.** Somaram-se 23 novos. Consertei 5 e provei os consertos com teste; escrevi as migrations de mais 2 e **não as apliquei** — mexer em função de banco com dinheiro passando ao vivo é decisão sua, não minha.

| | |
|---|---|
| Confirmados | **31** (3 críticos, 18 altos, 9 médios, 1 baixo) |
| Consertados e provados nesta sessão | **5** |
| Migration escrita, **aguardando você aplicar** | **2** |
| Derrubados pelos céticos | **9** |
| Suíte do repositório depois de tudo | **722/722 verde** |

---

## Os três críticos

### 1. A tela de login real era servida no domínio do professor · **CONSERTADO**

Quando um professor conecta o domínio dele, a rota **anexa o nome ao projeto da Vercel antes de provar que ele é o dono**. Entre esse instante e a verificação — e de novo depois, se ele desconectar e a chamada de remoção falhar — o domínio ficava servindo a plataforma inteira: `/login`, `/signup`, `/account`, com certificado válido.

Quem controla aquele DNS recebe os cookies de sessão gravados naquela origem. Basta apontar o nome para uma página própria por alguns minutos.

O detalhe que fecha o caso: **o cabeçalho do próprio arquivo descreve esse ataque** como a razão de a proteção existir — "um dia algum deles vai deixar o domínio caducar; quem registrar depois herda um nome que o nosso certificado responde". A função falhava aberta justamente no caso que o comentário teme.

**A causa:** a função devolvia "siga em frente" para host desconhecido, com um comentário dizendo "pode ser o nosso próprio host". Só que quem chama **já descarta o host da plataforma antes**. O comentário estava desatualizado; o que sobrava ali era exatamente o caso perigoso.

**O conserto:** falhar fechado. Consertado, 4 testes provam, e os 31 testes que já existiam do arquivo continuam passando.

### 2. Curso pago entregue de graça · **migration escrita, não aplicada**

O professor cria o curso grátis, publica, depois cadastra uma oferta de US$ 497 sem marcá-la como padrão — que é o caminho de upsell que o sistema de ofertas existe para suportar.

A função que dá matrícula grátis decide o preço olhando **só as colunas antigas da tabela de cursos**, que uma oferta não-padrão nunca atualiza. A página cobra 497 pelo Stripe. E qualquer aluno logado leva de graça com uma linha no console do navegador.

Pior: a matrícula fica marcada como "curso grátis", então **nem a conciliação denuncia**. O professor perde a venda, a plataforma perde a taxa, e não sobra rastro de que houve uma.

**Confirmei em produção agora:** a função no banco ainda é a antiga.

### 3. Os testes que provam a segurança do banco nunca rodaram · **CONSERTADO (parcial)**

Existem 4 testes de isolamento de dados em `supabase/tests/`. **Nenhum comando do repositório os executava.** Um deles prova que ninguém consegue marcar a própria taxa de ativação como paga — ou seja, virar criador ativado **sem pagar**. Nunca foi executado por automação nenhuma.

Uma regressão de política de acesso passava por lint, tipos, 722 testes e build, todos verdes.

**Por que ninguém automatizou:** são scripts de banco que precisam de dados reais para rodar. Criei o comando (`npm run test:db`) e um passo de CI. Sem o endereço de um banco de teste, o passo **avisa em voz alta** em vez de passar calado — a lacuna agora aparece em toda execução. Falta você configurar esse endereço.

---

## O que consertei e provei

| # | O que era | Prova |
|---|---|---|
| A-01 | Login servido em domínio não verificado | 4 testes verdes + 31 antigos intactos |
| A-10 | HSTS falando pelos subdomínios do professor e inscrevendo o nome dele na lista de preload | 1 teste verde |
| A-17 | Moeda da oferta aceitava qualquer sigla e virava USD em silêncio | 1 teste verde |
| A-18 | O scan de segredos varria **zero commits** no push e no cron semanal | 2 testes verdes |
| A-03 | Testes de banco sem nenhum executor | 2 testes verdes |

Sobre a moeda: o repositório **já tinha** o validador (`isSupportedStripeCurrency`). A rota simplesmente não o chamava, e a normalização downstream trocava a moeda desconhecida por USD sem avisar ninguém — "SEK 990" virava "USD 990".

Sobre o scan de segredos: ele recebia um ponto de partida igual ao ponto de chegada. Intervalo vazio, zero commits, job verde. **O conserto foi de duas linhas.**

## O que escrevi e NÃO apliquei

Duas migrations, prontas e comentadas, com asserção que falha alto se o problema voltar:

- **`20260830120000`** — matrícula grátis passa a consultar as ofertas de verdade.
- **`20260830120100`** — o limite de tentativas da verificação pública de certificado deixa de aceitar chave escolhida por quem chama.

**Não apliquei de propósito.** Alterar função de banco enquanto dinheiro passa ao vivo é o tipo de ação que eu não faço sozinho. Revise e aplique quando quiser.

---

## O achado do banco que ninguém tinha visto

O banco tem **51 alertas de segurança ao vivo**. Triei todos.

**O mais assustador é falso.** O sistema acusa 39 funções privilegiadas alcançáveis por qualquer usuário logado — inclusive uma que **muda o papel de qualquer pessoa para administrador**. Fui ler: ela exige admin logo na primeira linha, valida os papéis contra lista fechada, impede você de remover o próprio acesso, impede a plataforma de ficar sem nenhum administrador, e grava auditoria. Está bem feita. Registrei a refutação para a próxima auditoria não gastar tempo.

**O real é outro, e é bonito de errado:** a verificação pública de certificado tem limite de 60 tentativas por hora, **e a chave desse limite é escolhida por quem chama**. Manda um valor diferente a cada vez, ganha um balde novo a cada vez.

E cada chave nova **grava uma linha permanente** numa tabela sem limpeza. O mecanismo que existe para conter abuso é o vetor de abuso: qualquer pessoa na internet enche o banco.

Medi antes de alarmar: **ninguém explorou.** 73 linhas, 72 kB, zero registros desse tipo. Risco aberto, não incêndio.

---

## Os 9 achados que os céticos derrubaram

Registro para a próxima auditoria não gastar tempo com eles: as 39 funções admin (barram por dentro); "15 dos 16 gatilhos de produção não existem nas migrations"; "a cadeia de migrations não aplica em banco vazio"; o endpoint público de ofertas "expondo preços" (as colunas são estruturalmente nulas nas linhas expostas); "reentrega de webhook é estruturalmente insegura"; e mais quatro.

Uma correção que um cético fez e vale registrar: um agente afirmou que **não existe camada de borda** porque não achou `middleware.ts`. Existe — o projeto usa Next 16, que renomeou o arquivo para `proxy.ts`. A conclusão sobreviveu (o arquivo declara explicitamente que não decide identidade), mas a premissa estava errada. É exatamente para isso que a refutação existe.

---

## Fila aberta, em ordem de retorno

**Agora (dinheiro e acesso):**
1. Aplicar as 2 migrations acima
2. **MFA contornável** — o cookie de sessão é gravado **antes** do código de 6 dígitos, e nenhuma verificação olha o nível de garantia. Quem tem só a senha entra. O segundo fator é decorativo hoje. Há um agravante: **não existe um único teste de MFA** no repositório
3. **Reembolso não revoga acesso** quando cai numa janela específica de reentrega do Stripe
4. **Duas sessões de checkout pagáveis** para o mesmo pedido (o lock não filtra pelo próprio pedido)
5. **Cancelar assinatura não revoga a matrícula** se o aluno já concluiu

**Depois:** status de verificação de domínio escrito pelo cliente; cota de domínios burlável por corrida; teto de concorrência do advisor que não limita nada; 5 defeitos de frontend (formulário que apaga o que você digitou, tela que trava depois de 90s, laço infinito no preview do curso, erro fora do campo de visão); e 4 lacunas de teste onde o caminho principal de venda **só é testado quando falha**.

Detalhe de cada um, com arquivo e linha, em `achados.json`.

---

## Como reproduzir tudo isto

```bash
# as provas dos bugs (vermelhas viram verdes conforme cada um é corrigido)
npx vitest run --config .auditoria-2026-08-30/vitest.provas.config.ts

# o portão de integridade: todo achado ancorado em arquivo e linha que existem
py -3.13 .auditoria-2026-08-30/prova.py
```

A suíte de provas vive **fora** de `src/` de propósito: um teste vermelho lá dentro deixaria o `npm test` e o CI vermelhos em todo PR futuro, e o relatório viraria ruído permanente em vez de sinal. Conferido: `npm test` coleta **zero** arquivos desta pasta.
