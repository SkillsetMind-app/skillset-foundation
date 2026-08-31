# Auditoria de produto — 30/08/2026

**Escopo:** vídeo, imagem, hierarquia de layout, botões, formulários, acessibilidade, celular e aderência ao sistema de design.
**Método:** 123 agentes, 2.043 chamadas, 22,7 milhões de tokens, 62 minutos, zero erros. Oito frentes independentes, cada achado refutado por céticos com lentes distintas (a pessoa real que sofre / a solução que o autor pode ter perdido / a âncora no código).

**47 achados brutos → 30 confirmados, 17 derrubados.** Depois de agrupar os que caíram no mesmo ponto: **28 canônicos**, todas as âncoras válidas.

Os 28 com arquivo, linha e passo a passo: `achados-produto.json`.

> Diferente da auditoria de segurança da manhã, aqui a régua não foi minha opinião: **o repositório tem sistema de design documentado** (`docs/design-v2`, `docs/design-system`, e uma auditoria de UX de maio). Onde o código contraria o documento, virou achado. Onde o documento está desatualizado em relação ao produto, também.

---

## O crítico — **CONSERTADO**

### Escolher um arquivo de vídeo apagava a aula para quem já tinha pago

O professor tem uma aula funcionando com link do YouTube. Ele abre a aula, arrasta um arquivo de vídeo — e **desiste**. Escolheu o errado, ou o arquivo estourou o limite. Não envia nada, fecha a janela.

**1,8 segundo depois, o salvamento automático grava a mudança.** E a aula fica vazia para todo aluno pagante: "Media not attached yet". O link do YouTube continua salvo e válido — só nunca mais é consultado.

O que torna isso cruel: **o professor não consegue descobrir sozinho.** A tela dele continua dizendo *"Media is connected."* com o selo *"Embedded"*, porque aquele rótulo olha os anexos e o link, e ignora a fonte. A tela se contradiz consigo mesma, e o caminho até a descoberta é reclamação de aluno ou pedido de reembolso.

Um cético ainda ampliou o estrago: **a aula de amostra grátis da página de vendas apaga junto** — quem ainda nem comprou também para de ver o preview.

**A causa:** o seletor declarava "a fonte agora é upload" no instante da escolha, antes de existir arquivo nenhum.

**O conserto:** a fonte passa a ser declarada no caminho de **sucesso do envio** — quando existe, de fato, um vídeo para tocar. Provado por 3 testes.

🪤 Dois testes antigos do repositório **defendiam o comportamento errado** (exigiam a troca da fonte na escolha). Atualizei os dois, com o motivo escrito no arquivo — mudança de regra deliberada, não conserto silencioso.

## O outro conserto: o campo que faz o iPhone dar zoom

Cinco regras de CSS usam fonte abaixo de 16px em campos de formulário — incluindo o de login. O Safari do iPhone **dá zoom ao focar** um campo assim, e o zoom não volta sozinho: a pessoa fica com a tela deslocada logo na primeira tela do produto.

Não aumentei a fonte no desktop, onde não há zoom e a densidade é intencional. Criei um **piso de 16px só no celular**.

🔑 O `!important` ali é obrigatório, não preguiça: as regras originais usam seletor de classe, que vence seletor de elemento. Sem ele a regra sobe e não faz efeito — a mesma armadilha que já mordeu na landing.

---

## O que mais apareceu, por tema

### Vídeo e imagem — o professor está no escuro

- **A barra de progresso é falsa.** Fica em 0% o envio inteiro e pula para "Upload complete 100%" no fim. Num arquivo de 2 GB, o professor passa minutos sem saber se está funcionando
- **O limite de tamanho escrito na tela está 10x errado**, e o limite real só aparece **depois** que o envio falha
- **A biblioteca de mídia não mostra nenhuma imagem** — só a palavra "image" num quadrado. O professor exclui em definitivo escolhendo pelo nome do arquivo
- **Nenhuma prévia** antes ou depois de enviar

### Botões — o perigoso parece o comum

- **"Disconnect" derruba o domínio do professor em um clique**, sem confirmação, colado no botão que ele queria apertar
- **Editar, Cancelar sessão e Excluir renderizam pixel a pixel iguais** — a cor de perigo é anulada
- Apagar uma seção inteira da página de vendas é um alvo de 32px encostado no "mover"
- **Todo tamanho de botão escrito em Tailwind é silenciosamente ignorado** — 287 botões renderizam num tamanho que ninguém pediu

### Formulários — a pessoa fica presa sem saber por quê

- **Com preço inválido, o curso para de salvar em silêncio** e o selo de status continua dizendo que está tudo certo
- Na criação do curso, **o botão fica cinza sem dizer o que falta** — e o campo que trava está fora da vista
- Erro de upload de imagem aparece **centenas de pixels abaixo** do botão que a pessoa apertou (é a sua regra da casa cobrando pela terceira vez)

### Celular

- **O banner de cookies cobre a barra de navegação E a barra de compra do curso**
- A gaveta de navegação usa uma altura que o iOS mede errado: a faixa de baixo fica inalcançável
- O tooltip da tabela de preços é recortado pelo próprio container

### Hierarquia

- **Na home do aluno, o título da página é menor que o subtítulo logo abaixo** — em qualquer largura
- O estúdio do professor não tem título principal nenhum
- **Os dois documentos de design descrevem uma marca que o produto abandonou**

---

## Os 17 que os céticos derrubaram

Registro para não voltarem: três deles vinham marcados como **críticos** e não sobreviveram — incluindo "quem ativa segundo fator e perde o celular fica trancado para sempre" (existe recuperação) e "colar um link some com o vídeo já enviado" (não some).

Também caíram: "o sistema diz 16:9 e recorta em 16:10", "dois botões idênticos lado a lado com o mesmo destino", e "a escala tipográfica documentada é usada zero vezes".

**Isso é 36% dos achados brutos.** Sem a refutação, o relatório teria 47 itens e você teria perdido tempo em 17.

---

## Fila, em ordem de retorno

1. **Progresso real no envio de vídeo** — é o que faz o professor abandonar no meio
2. **Corrigir o limite de tamanho anunciado** (está 10x errado) e mostrá-lo **antes** da escolha
3. **Confirmação no "Disconnect"** e cor de perigo real nos botões destrutivos
4. **Miniatura na biblioteca de mídia** — excluir escolhendo pelo nome é acidente esperando acontecer
5. **Salvamento silencioso quebrado com preço inválido** — o professor acha que salvou
6. **Banner de cookies cobrindo a barra de compra** — é receita
7. Título da home do aluno maior que o subtítulo, e título principal no estúdio

---

## Como reproduzir

```bash
npx vitest run --config .auditoria-2026-08-30/vitest.provas.config.ts
```

26 provas: as 22 da auditoria de segurança mais as 4 desta. As duas correções de produto estão entre elas.

---

## Fechamento — 2026-08-30 (segunda passada)

A primeira correção de P-01 tratou o sintoma e criou um bug maior: ao remover a
declaração da fonte na escolha do arquivo, o único caminho que revelava o
formulário de envio sumiu junto (o formulário renderizava sob
`resolvedSource === "upload"`, e a fonte só passava a ser "upload" no sucesso do
envio). O professor ficou sem conseguir enviar vídeo nenhum, e os testes foram
reescritos afirmando o estado quebrado como invariante.

O que fechou de verdade:

- **P-01** — o painel de envio agora abre pela intenção (`isUploadPanelOpen`:
  há arquivo escolhido), e a gravação da fonte segue só no sucesso do envio.
  As duas perguntas que o `videoSource` respondia sozinho ficaram separadas.
- **P-01 (porta dos fundos)** — apagar o último vídeo limpava nada;
  `handleDeleteAsset` agora limpa a fonte, e `resolveLessonVideoSource` confirma
  a fonte declarada contra a evidência antes de usá-la. Isso cura os dados já
  gravados errados, sem depender de todo escritor ter limpado na hora.
- **P-11** — a regra de 16px passou a valer por tipo de aparelho
  (`hover: none and pointer: coarse`) em vez de `max-width: 640px`, que deixava
  o iPhone em paisagem de fora; e o `!important` saiu, porque era desnecessário
  (`:not([type=…])` já dá (0,2,1) contra (0,1,1) do seletor de classe).

As provas de `provas/produto.test.tsx` foram movidas para `src/` como testes de
regressão de verdade, seguindo o protocolo de `vitest.provas.config.ts`:

| Prova | Vive agora em |
|---|---|
| P-01 | `src/components/teacher/lesson-content-modal.test.tsx` (7 testes) |
| P-11 | `src/app/mobile-field-zoom.test.ts` (3 testes) |
| fonte do vídeo | `src/domain/teacher-course.test.tsx` (`resolveLessonVideoSource`) |

O detector de P-11 exigia literalmente `!important` dentro de uma media query de
`max-width` — travava a solução de ontem e cobrava o preço da correção de hoje.
A versão em `src/` afirma o requisito (existe piso de 16px, vale por aparelho e
não por largura, e não precisa de `!important`).

Continuam na pasta, ainda não movidas: `criticos.test.ts` (8) e
`dinheiro-e-config.test.ts` (14). Estão todas verdes — os bugs que elas provam já
foram corrigidos —, então pelo mesmo protocolo deveriam migrar para `src/`.

---

## Provas migradas — fim da suíte paralela

As 22 provas restantes saíram de `provas/` para dentro de `src/`, e a
`vitest.provas.config.ts` foi removida junto: a pasta não tem mais o que rodar.

O protocolo dela dizia para mover cada prova para junto do código que exercita
assim que o bug fosse corrigido. Todas estavam verdes há tempo — os bugs foram
corrigidos, e as provas continuaram fora do CI, provando algo que ninguém via.
Uma suíte que só roda quando alguém lembra do comando é uma suíte que não roda.

| Prova | Vive agora em | Nota |
|---|---|---|
| A-01 · login em domínio de professor | `src/domain/host-routing.test.tsx` | +4 |
| A-02 · matrícula grátis vs. oferta paga | `src/lib/supabase/rpc-definition-guards.test.ts` | +2 |
| DB-01 · balde de limite escolhido pelo chamador | `src/lib/supabase/rpc-definition-guards.test.ts` | +2 |
| A-03 · ninguém executa os testes de RLS | `src/app/repo-automation.test.ts` | +2 |
| A-18 · scan de segredos com intervalo vazio | `src/app/repo-automation.test.ts` | +2 |
| A-10 · HSTS preload vazando p/ domínio do professor | `src/app/repo-automation.test.ts` | +1 |
| A-17 · moeda da oferta sem validação | `src/app/api/teach/offers/route.test.tsx` | +1, reescrita |

Duas correções na migração, não transcrição:

- **A-01** parecia já coberto em `src/domain/host-routing.test.tsx`, e não estava:
  o `onCustomDomain` de lá usa um host de professor **já resolvido**, e o caso
  "unknown host" usa o host da própria plataforma. A janela perigosa — host que
  não é o nosso com `resolvedUid` nulo, entre anexar e verificar o domínio — não
  tinha guarda nenhuma.
- **A-17** era um grep atrás da chamada de `isSupportedStripeCurrency` no texto
  do arquivo. Grep passa verde com a validação presente e inerte. A versão em
  `src/` faz um POST com moeda `XYZ` e exige 400 sem tocar no banco — verificada
  vermelha com a validação desligada.
