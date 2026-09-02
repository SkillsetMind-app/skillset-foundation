# Reanálise — Produtos e Área de Membros (2026-09-02)

> Texto extraído do projeto Claude Design "Reanalise - Produtos e Area de Membros" (arquivo `Reanalise - Produtos e Area de Membros.dc.html`), importado em 2026-09-02. É a especificação dos 12 itens implementados nas PRs de reanálise (#150 em diante). Os títulos de seção são do documento original; o texto corrido está achatado (sem a formatação HTML). Os itens estão numerados na ordem em que foram atacados: 1 moeda · 2 barra recolhida · 3 sino · 4 aula no endereço · 5 Planos · 6 Ops · 7 próxima aula · 8 playlist · 9 abas com endereço · 10 painel do aluno · 11 Meus produtos · 12 caixa de mensagens.

---

Reanálise
Como ler
Produtos
Moeda
Aula
Vídeo
Painel
Avisos
Ir e voltar
Celular
Animações
Ops
Barra lateral
Começar
main @ 123f95f
Reanálise · 2 set 2026 · lido em main @ 123f95f
Meus produtos e Área de membros: o que mudar e por quê
Este documento refaz a leitura anterior em linguagem direta e amplia o alcance: entra a área de membros inteira (aula, vídeo, painel do aluno, avisos, mensagens, comunidade, celular e animações), a página de Operações e a barra lateral recolhida. Tudo foi lido no código do repositório — por isso cada proposta traz, em letra pequena, o arquivo que o seu agente precisa abrir.
Hoje
Como está no código, desenhado em esquema. Os números vermelhos ligam o desenho ao texto.
O que atrapalha
Em linguagem simples, do ponto de vista de quem usa: aluno, professor ou operador.
Proposta
O que mudar, na ordem em que faz sentido. Esforço: pequeno = horas · médio = alguns dias · grande = uma semana ou mais.
Em uma frase, por área
Meus produtos
— a lista é o assunto da página, mas é a última coisa que aparece; e o seletor de moeda sai do cartão.
Tela da aula
— o vídeo começa a meio metro do topo e a lista de aulas fica embaixo dele, não ao lado.
Vídeo
— o avanço automático já existe, mas acontece em silêncio: sem aviso, sem cancelar, sem tocar sozinho.
Painel do aluno
— dá boas-vindas duas vezes e mostra números antes de mostrar os cursos.
Avisos, mensagens e comunidade
— três canais em três lugares diferentes, nenhum com caminho de volta.
Operações e barra recolhida
— a página de trabalho abre como página de marketing; no modo recolhido os ícones perdem o nome e o botão de abrir fica solto na borda.
01 · Professor
Meus produtos e criação de curso
A lista de produtos é o assunto da página, mas é a última coisa que aparece. Criar um produto pede duas telas e promete três passos; o terceiro nunca acende.
Hoje · Meus produtos
1
3
2
Atalhos → tipo → status → lista sem cabeçalho de coluna
1
Antes do primeiro produto, o professor passa por três faixas: quatro atalhos grandes (Membros, Eventos, Marketing, Cupons), o seletor Produtos/Comunidades e cinco abas de status. Os atalhos levam para fora da página — são navegação, não conteúdo.
2
Cada linha tem quatro botões (Gerenciar, Editar, Revisar e publicar, Excluir). Com dez produtos são quarenta botões; em tela de notebook eles quebram em duas linhas. Confirmar a exclusão troca os botões no lugar e a linha muda de largura.
3
No desktop a lista não tem cabeçalho de coluna: três colunas sem nome. Os rótulos existem, mas só aparecem no celular, em letra de 10px.
4
Criar um produto pede duas telas (formato → informações). O rail lateral promete três passos, o formulário diz "passo 1 de 2" e o terceiro passo nunca acende. Depois, o construtor mostra duas manchetes e duas listas de "o que falta para publicar" com regras diferentes da terceira, em Gerenciar.
Proposta · Meus produtos
Produto
Status
Acesso
Alunos
⋯
⋯
Lista primeiro · cabeçalho real · uma ação + menu ⋯ · atalhos no rodapé
1
A lista abre a página: título, botão "Novo produto", busca e dois filtros (status; curso ou comunidade). Os atalhos descem para o rodapé — já existem na barra lateral.
2
Tabela com cabeçalho (Produto · Status · Acesso · Alunos) e uma ação por linha: "Abrir". Editar, Ver como aluno, Duplicar e Excluir ficam no menu ⋯. Excluir pede confirmação numa janela, sem trocar os botões da linha.
3
Criar produto numa tela só: formato + título + promessa + categoria. O rail mostra os cinco estágios do fluxo inteiro (Formato, Básico, Preço, Aulas, Publicar), com os dois primeiros aqui e os demais no construtor.
4
Uma só lista de "o que falta para publicar", calculada num lugar e lida por todas as telas (construtor, rodapé e Gerenciar). A barra de progresso, o chip de porcentagem e o texto passam a mostrar o mesmo número.
src/components/teacher/teacher-course-studio.tsx
create-course-start.tsx:57–61, 190–236
course-builder-studio.tsx:667–715, 776–784, 2716–2725 (readiness)
course-manage-hub.tsx:308–340
Preço e moeda: o seletor sai do cartão
Hoje
Price
Currency
USD - US Dollar
▾
A coluna dá 140px; o seletor precisa de ~190px e passa da borda do cartão
Preço e moeda dividem uma linha: o preço fica com o espaço que sobra e a moeda com 140px fixos. Só que o seletor mostra "USD - US Dollar", "BRL - Brazilian Real"… e um seletor nunca fica mais estreito que a sua opção mais larga. Resultado: ele empurra a borda e sai do cartão em telas médias e grandes (abaixo de 768px vira uma coluna e o problema some).
Proposta
Preço
149
Moeda
USD
▾
Coluna minmax(0, 200px) · seletor com largura 100% · fechado mostra só o código
Trocar
md:grid-cols-[1fr_140px]
por
md:grid-cols-[minmax(0,1fr)_minmax(0,200px)]
e dar ao seletor
w-full min-w-0
. Uma linha; resolve o transbordo.
Fechado, o seletor mostra só o código (USD); o nome completo fica nas opções abertas. Cabe em qualquer largura.
Em Gerenciar → Preços e ofertas, a moeda é um campo de texto livre de três letras. Usar o mesmo seletor nos dois lugares.
course-builder-studio.tsx:1949 (grid) · 1964–1990 (select)
course-offers-panel.tsx:191–195
02 · Aluno
Área de membros: a tela da aula
O vídeo — o motivo de o aluno estar ali — começa a meio metro do topo, e a lista de aulas fica embaixo dele, não ao lado. Tudo o mais (comunidade, mensagens, lives, arquivos, avaliação) mora na mesma rolagem, sem endereço próprio.
Hoje · uma página, 4 a 6 telas de altura
1
6
capa · ~420px
Lesson tools
▶
vídeo a ~550px do topo
2
Now playing
Aula
3/12
Arquivos
2
3
4
5
Arquivos do curso
Lives
Comunidade — feed inteiro, abas, ranking, composer
Mensagens para o professor
Avaliação
1
Capa grande em toda aula: título de 56px, descrição e barra de progresso somam ~420px; depois vem a faixa "Lesson tools" (quatro chips e três botões). O vídeo começa a ~550px no desktop e depois de uma tela e meia no celular. A capa é ótima na primeira visita; na décima aula, é obstáculo.
2
Ao lado do vídeo há um cartão de números ("Aula 3/12 · Arquivos 2"), um cartão "Continuar" e uma lista de links. O que o aluno quer ali é a lista de aulas.
3
A lista de aulas existe três vezes — cartão "Continuar", trilho de módulos + grade de cartões, e a janela "Todas as aulas" — e nenhuma fica visível enquanto o vídeo toca.
4
Cada cartão de aula tem o próprio botão "Concluir": doze aulas, doze botões — além do botão principal sob o vídeo.
5
Comunidade (o feed inteiro, com abas e ranking), mensagens, lives, arquivos e avaliação vêm depois do currículo, na mesma rolagem. Nada disso tem endereço próprio: não dá para mandar o link "comunidade do curso" nem voltar para ele pelo histórico.
6
Três saídas para o mesmo lugar ("Exit to dashboard" no topo, "Back to dashboard" na capa, "Back to My Learning" na lateral) e um link para a página de vendas dentro da sala.
Proposta · vídeo + playlist + abas com endereço
← Meus cursos
42%
▶
aluno@email · 20:14
vídeo a ~120px do topo
Aula
Materiais 2
Comunidade
Mensagens
1
Avaliação
Sobre
Módulo 1
▾
Módulo 2
▸
Módulo 3
🔒
fixa, rola até a aula atual
1
Vídeo em primeiro lugar, a ~120px do topo. A capa vira a página inicial do curso (primeira visita, ou a aba "Sobre"), não o cabeçalho de toda aula.
2
Playlist ao lado do vídeo: módulos em acordeão, aula atual destacada, check e cadeado por aula, busca no topo. Substitui o cartão de números, o trilho e a grade. No celular vira acordeão abaixo do vídeo.
3
Um só lugar para concluir: o botão sob o vídeo (e o avanço automático). Na lista, só o check — clicável para desfazer.
4
Materiais, Comunidade, Mensagens, Avaliação e Sobre viram abas com endereço próprio. Clicar abre a aba; o botão voltar do navegador devolve à aula. Um link de comunidade pode ser compartilhado.
5
Uma saída: "← Meus cursos" no topo. O link da página de vendas sai da sala.
6
O componente da sala tem 74 KB num arquivo só. Separar em Player, Playlist e Abas deixa cada mudança acima pequena e testável.
src/components/learn/enrolled-course-workspace.tsx (667–1170)
members-area-hero.tsx
member-area-shell.tsx
lesson-list-overlay.tsx
globals.css: .member-classroom-* (4036–4760), .members-hero* (6348–6550)
03 · Aluno
Vídeo e próxima aula automática
O avanço automático já existe — só acontece em silêncio. Quando o vídeo termina, a aula muda sem aviso, sem "cancelar" e sem o próximo vídeo começar a tocar.
Hoje
aluno@email.com - 1 set 2026, 20:14
SkillsetMind protected playback
▶
fim do vídeo
→
marca como concluída
→
troca a aula, sem aviso
→
o próximo não toca
1
Quando o vídeo termina, o código marca a aula como concluída e seleciona a próxima. Funciona com upload (Bunny), YouTube/Vimeo e arquivo direto. O sinal de "terminou" do Bunny está anotado no código como não verificado — vale testar num curso real.
2
Não há aviso: a aula muda sem "próxima em 5 s" nem "cancelar". O próximo vídeo carrega, mas não começa a tocar — o aluno precisa clicar de novo.
3
Se o aluno rolou até a discussão, a troca acontece fora da tela: ele volta e encontra outro vídeo, sem saber por quê.
4
Duas etiquetas de marca d'água ficam sobre o vídeo o tempo todo: e-mail e hora no canto superior, "protected playback" no inferior.
5
A posição do vídeo não é lembrada: voltar a uma aula começa do zero.
Proposta
aluno@email.com · 20:14
5
Próxima aula
Assistir agora
Cancelar
fim do vídeo
→
cartão com contagem de 5 s
→
próxima começa a tocar
→
página rola até o player
1
Ao terminar: cartão "Próxima aula" sobre o vídeo, com miniatura, título, contagem de 5 s, "Assistir agora" e "Cancelar". Sem ação, a próxima começa a tocar (autoplay no embed — permitido porque o aluno já interagiu com a página).
2
Ao trocar de aula, a página rola suavemente até o player e a playlist rola até a aula atual. A troca nunca acontece fora da tela.
3
Uma etiqueta só, pequena e translúcida, que muda de canto a cada ~30 s. Continua carimbando a gravação inteira (o objetivo anti-pirataria) e atrapalha menos.
4
Modo cinema (esconde a playlist, o vídeo ocupa a largura) e atalhos de página: N = próxima aula, P = anterior, F = tela cheia. Espaço e setas já são do próprio player.
5
Lembrar onde parou, por aula (segundo atual salvo a cada 10 s), e retomar ao voltar — o mesmo dado alimenta o "Continuar assistindo" do painel.
enrolled-course-workspace.tsx:632–665 (handleLessonEnded)
courses/bunny-video-player.tsx
learn/trusted-embed-player.tsx
learn/watermarked-video-player.tsx
04 · Aluno
Painel do aluno (/learn)
Dá boas-vindas duas vezes e mostra números antes de mostrar os cursos. O que o aluno quer ao entrar é continuar de onde parou e ver o que chegou de novo.
Hoje
1
2
3
1
0
0
4
Pedir reembolso
1
Duas manchetes antes do conteúdo: a do cabeçalho da página e a do "Welcome back" logo abaixo (a segunda já foi reduzida; a primeira continua).
2
"Continuar" é um cartão de texto, sem capa nem miniatura da aula. Abrir leva à capa do curso, não à aula onde o aluno parou.
3
Três cartões de métrica ocupam uma linha inteira para dizer "1 · 0 · 0".
4
Cada curso matriculado é um cartão grande com categoria, título, chip, resumo, caixa de dados e dois botões: "Abrir" e "Pedir reembolso", lado a lado.
5
O que chegou de novo (resposta na comunidade, mensagem do professor, certificado emitido) só aparece no sino.
Proposta
Olá, Patrick
Continuar assistindo
▶
Módulo 2 · Aula 5 · 12 min restantes
▶
Módulo 1 · Aula 2 · 4 min restantes
▶
Módulo 4 · Aula 11 · 2 min restantes
Próximas lives
QUI 19h
SÁB 10h
Novidades
Ana respondeu ao seu post
Mensagem do professor · Liderança
Certificado emitido · Comunicação
Meus cursos
62%
20%
88%
concluído
1
Uma saudação curta, com sino e avatar na mesma linha. O cabeçalho do shell sai (hideHeader), como já acontece no estúdio do professor.
2
"Continuar assistindo": miniaturas com barra de progresso, módulo e aula, minutos restantes. Clicar abre direto na aula, no ponto em que parou.
3
Duas colunas: "Próximas lives" (dia e hora, curso, Entrar) e "Novidades" — as três últimas notificações, cada uma levando ao lugar certo, com volta.
4
"Meus cursos" em grade de capas com porcentagem e filtro Em andamento / Concluídos. Reembolso vai para a aba Sobre do curso ou para Conta → Pagamentos.
5
Métricas viram uma linha de texto ("2 cursos em andamento · 1 live esta semana") ou saem. As trilhas curadas e "Mais deste professor" continuam, abaixo de Meus cursos.
src/components/learn/learn-dashboard.tsx
learner-overview-metrics.tsx
learning-paths-rows.tsx
src/app/learn/page.tsx (hideHeader)
05 · Aluno
Avisos, mensagens e comunidade
Três canais, três lugares diferentes, nenhum com caminho de volta. E dentro da sala de aula — onde o aluno passa o tempo — não há sino.
Notificações
sino no painel (/learn, /teach, /ops)
caixa em Conta → Notificações
sala de aula: sem sino
A sala de aula usa outra casca (sem barra lateral) e essa casca não tem o sino. O painel de mensagens diz "a resposta cai no sino", mas o sino não está nessa tela.
Clicar numa notificação leva ao link e fecha o menu; para voltar, só o botão do navegador — e a página de destino não tem "voltar".
Mensagens (aluno ↔ professor)
painel no fim da página da aula
professor: inbox em /teach/messages
aluno: sem caixa de entrada
Para responder ao professor é preciso rolar quatro ou cinco telas, depois da comunidade.
Com três cursos, são três lugares. O aluno não tem uma lista de conversas; o professor tem.
Comunidade
embutida no fim da página da aula
/learn/community/[slug] dentro do painel
duas caras para o mesmo conteúdo
Pela aula, a comunidade aparece no tema do curso; pelo sino ou pela barra lateral, abre no painel com manchete grande e outra moldura. É o mesmo feed com duas caras.
Nenhuma das duas volta para a aula. E a comunidade embutida repete a própria manchete ("Course community", 36px) dentro da sala.
Proposta · um lugar, com sino e volta
← Meus cursos
🔔
2
Aula
Materiais
Comunidade
1
Mensagens
1
Avaliação
endereço:
/learn/courses/lideranca/comunidade?aula=5
· voltar devolve à aula 5
1
O sino entra na barra da área de membros — mesmo componente, mesma lista de avisos.
2
"Comunidade" e "Mensagens" viram abas do curso, com endereço próprio e contador de novidades. /learn/community/[slug] passa a redirecionar para a aba — uma cara só, sempre no tema do curso.
3
Caixa de entrada do aluno em /learn/mensagens: lista de conversas por curso, no molde da que o professor já tem.
4
Toda notificação abre a página certa, e essa página tem "← Voltar" para onde o aluno estava (aula ou painel). A regra completa está na seção seguinte.
member-area-shell.tsx (header)
platform/notification-bell.tsx
learn/course-messages-panel.tsx
learn/course-community-feed.tsx
app/learn/community/[slug]/page.tsx
teacher/teacher-messages-inbox.tsx (modelo)
06 · Regra de navegação
Ir e voltar
Se dá para clicar, tem que ter endereço. Se tem endereço, tem que ter volta. Uma regra só, aplicada em todo lugar, resolve a maior parte da sensação de "onde eu estava?".
Painel
/learn
→
Aula 5
/learn/courses/lideranca?aula=5
→
Aba Comunidade
…/lideranca/comunidade?aula=5
→
Post
…/comunidade/post-123?aula=5
← em cada tela leva um nível acima; o botão voltar do navegador faz exatamente o mesmo caminho, porque cada passo é um endereço.
Onde quebra hoje
1
"Aula atual", "Materiais" e "Discussão" são botões que só rolam a página. Parecem navegação, mas não levam a lugar nenhum — e não há como voltar de onde rolaram.
2
A aula selecionada não está no endereço. Recarregar a página ou voltar do navegador abre a "primeira aula não concluída", não a que o aluno estava vendo.
3
"Meus cursos" no estúdio do professor e a pré-visualização do curso abrem em nova aba; a pré-visualização ainda tem um "Sair" que volta na aba errada.
4
Páginas abertas pelo sino (comunidade, curso, certificado) não têm seta de voltar; a barra lateral também não acende nada quando o aluno está em Conta.
Quatro regras
1
Toda tela tem endereço: aba, post, conversa, certificado, produto. Se aparece ao clicar, aparece na barra do navegador.
2
A aula atual vai no endereço (?aula=…). Compartilhar o link abre a mesma aula; recarregar mantém o lugar.
3
Voltar é sempre a seta no canto superior esquerdo e leva um nível acima (post → comunidade → aula → painel). O botão do navegador faz o mesmo.
4
Nada do próprio app abre em nova aba — só links externos (live, material externo, Stripe).
enrolled-course-workspace.tsx:118 (selectedLessonId sem URL), 714–750 (botões que rolam)
data/site.ts:74–82 (newTab)
teacher/course-preview-shell.tsx
07 · Todos os dispositivos
Celular e tablet
Funciona no celular, mas o vídeo chega tarde e cada aula pede o dobro de toques. O layout já quebra bem em 1180px e 1023px; o que falta é a ordem das coisas.
Hoje
▶
1,5 telas para chegar aqui
Proposta
←
▶
Aula
Materiais
Comunidade
Mensagens
Avaliação
Módulo 1
▾
Módulo 2
▸
← Anterior
Concluir e próxima
Hoje
Capa (título de 38px, descrição, barra) mais a faixa de ferramentas — que quebra em três ou quatro linhas — empurram o vídeo para depois de uma tela e meia.
Lista de aulas em coluna única, cada cartão grande e com o próprio botão "Concluir". Comunidade, mensagens e avaliação vêm depois, na mesma rolagem.
O que está bom e fica: a barra fixa embaixo com ←, Todas as aulas e Concluir; os alvos de 44px nos botões principais; a quebra em 1180px (lateral vira três cartões) e 1023px (uma coluna).
Proposta
Celular: vídeo colado no topo e fixo — encolhe para um mini player enquanto o aluno rola a lista. Abaixo, título e "Concluir e próxima"; abas roláveis na horizontal; playlist em acordeão; barra fixa embaixo com Anterior e Concluir.
Tablet (768–1180px): vídeo em cima e playlist em duas colunas; a partir de 1180px, lado a lado. Entre 768 e 1023px, o painel do professor/aluno usa a barra lateral recolhida (rail de 64px, que já existe) em vez da barra de baixo de celular.
Toque: tudo o que se toca com 44px de altura (abas do produto, botões de linha, rótulos da barra de baixo ≥ 11px).
globals.css: @media 1180 / 1023 / 640 (.member-*) · 6185–6200 (.platform-grid)
platform/mobile-sidebar-drawer.tsx
08 · Movimento
Animações
Movimento confirma uma ação ou mostra de onde algo veio. Nunca decora. Abaixo, o que se move, quando e por quanto tempo — uma regra por elemento, para o agente aplicar igual em todo lugar.
Elemento
Quando
O que acontece
Duração
Botões
passar o mouse · clicar
fundo escurece 8%; ao clicar encolhe para 98% e volta. Sem "pulo" para cima, sem sombra que cresce.
150 ms · 100 ms
Concluir aula
ao marcar
o check da aula na playlist preenche com um leve "pop"; a barra de progresso do curso cresce até o novo valor.
200 ms · 400 ms
Troca de aula
ao selecionar
vídeo antigo esmaece; título novo entra deslizando 8px de baixo; a playlist rola até a aula atual.
150 ms + 250 ms
Fim do vídeo
ao terminar
o cartão "Próxima aula" sobe de baixo com o anel de contagem de 5 s girando; "Cancelar" interrompe o anel e o cartão desce.
250 ms · anel 5 s
Abas
ao trocar
o indicador desliza até a nova aba; o conteúdo troca com fade, sem a página pular.
200 ms · 150 ms
Sino
ao chegar aviso · ao abrir
o contador dá um pequeno salto; o menu abre com fade e 4px de deslocamento.
300 ms · 150 ms
Mini player (celular)
ao rolar
o vídeo encolhe e se fixa no topo; volta ao tamanho quando a rolagem retorna.
200 ms
Barra lateral
recolher · expandir
a largura anima (já existe); os rótulos aparecem depois que a largura termina, não junto — hoje o texto some antes da barra encolher.
240 ms
Regra geral.
Entre 150 e 400 ms, curva ease-out (rápido no começo, suave no fim). Só mudam opacidade, posição e tamanho — nunca cor de texto ou largura de layout.
Reduzir movimento.
Com a preferência do sistema ligada, tudo vira instantâneo. A regra já existe no CSS global e passa a cobrir também os novos elementos.
O que sai.
Cartões entrando em cascata (o efeito escalonado da home), retratos que giram sozinhos no topo do site, qualquer coisa que pulsa parada.
09 · Operador
Operações (/ops)
Uma página de trabalho que abre como página de marketing. Quem opera a plataforma entra todo dia para tratar filas — e a primeira fila começa a ~350px do topo, depois de uma frase de efeito, três métricas e filtros que nem toda aba usa.
Hoje
6
Ops ▾
Ops
1
A calm operations layer behind the learning experience.
3
Verification
Catalog
Payments
Community
Support
Users
Audit
Period ▾
Status ▾
2
3
2
1
4
Sensitive actions across the platform.
5
Access levels
1
O título é uma frase de marketing de 48px em serifa, com sobretítulo, subtítulo e uma legenda de três definições. A fila de trabalho começa a ~350px.
2
A ordem é abas → filtros → métricas → conteúdo. As três métricas não mudam com a aba, então interrompem o caminho entre a aba escolhida e o seu conteúdo.
3
Os filtros Período e Status ficam fora das abas, mas nem toda aba os usa (Usuários e Auditoria, por exemplo). Sete abas numa linha só, em inglês fixo.
4
Cada painel abre com a própria manchete em serifa ("Sensitive actions across the platform.") e um parágrafo — mais uma camada de título antes da tabela.
5
"Níveis de acesso" e "Ver como" (aluno, professor, equipe) ficam no fim da página, fora das abas: dois modelos de navegação na mesma tela.
6
Na barra lateral, "Operations" é um grupo com um único item, também chamado "Operations": clica para abrir e vê o mesmo nome. E as páginas de Conta não existem na barra — em Conta → Planos, nada acende.
Proposta
Verif.
Catál.
Pagam.
Comun.
Suporte
Usuár.
Audit.
Acessos
Verificação de professores
3 pendentes · 2 em revisão
Últimos 7 dias ▾
Abertos ▾
Professor
Enviado
Status
a fila começa a ~120px · contadores na barra, não em cartões
1
Título compacto ("Operações" ou o nome da fila, 24px), sem sobretítulo nem frase de efeito. A fila começa a ~120px.
2
As filas viram itens diretos da barra lateral (Verificação, Catálogo, Pagamentos, Comunidade, Suporte, Usuários, Auditoria, Acessos), cada uma com endereço próprio — a barra passa a fazer o papel das sete abas. Se preferir manter as abas, o grupo "Operations" vira item único, sem acordeão.
3
Os números viram contadores ao lado do item ou da aba (Verificação 3, Suporte 2, Comunidade 1). Os três cartões de métrica saem.
4
Filtros dentro da fila que os usa, na mesma linha do título. Painéis sem manchete: título de 16px e a tabela.
5
"Acessos" (papéis + ver como) vira a oitava fila. O "Ver como aluno / professor" também entra no menu do avatar, onde um admin vai procurá-lo.
6
Em /account/*, a barra mostra o grupo "Conta" (Configurações, Planos e taxas, Pagamentos, Cobrança, Notificações) e acende o item atual — em qualquer contexto.
src/app/ops/page.tsx
admin/ops-dashboard.tsx (opsTabs, filtros)
admin/ops-overview-metrics.tsx
admin/view-as.tsx
data/site.ts:249–256 (Operations), 268–310 (Account contexts: [])
platform-nav.tsx:83 (directSections)
10 · Todos os papéis
Barra lateral recolhida e a página de Planos
No modo recolhido, os ícones perdem o nome e o botão de abrir fica solto na borda. Na página de Planos (a captura que você enviou), o plano atual aparece três vezes e os cartões não se alinham.
Hoje · a captura, em esquema
»
1
2
Account ›
Plans & fees
Choose the plan that fits your course business.
3
Current plan
Free
MONTHLY
Pay each month
YEARLY
~17% off
4
Free
Your plan
$16
$74
$166
1
O botão "»" de expandir fica meio para fora da barra, em cima da linha que separa barra e conteúdo — parece um elemento perdido. No código ele é posicionado na borda, a 4,6rem do topo, justamente para não cobrir a marca.
2
Os ícones não têm nome: recolhido, o rótulo some e os links não ganham dica ao passar o mouse (só os grupos têm title). Cada ícone vem numa caixinha com borda; dois empilhados parecem botões desabilitados. E nenhum acende: em Conta → Planos a barra mostra Operações e Marketplace, nenhum deles a página atual. Clicar num grupo recolhido expande a barra inteira; a busca (Ctrl K) some.
3
"CURRENT PLAN / Free" flutua entre o cartão de abertura e o seletor Mensal/Anual, sem moldura, como terceira manchete da página (depois de "Plans & fees" e "Choose the plan that fits…"). O cartão Free ainda repete "Current" no chip e "Your plan" no botão: o plano atual é dito três vezes.
4
Os quatro cartões têm alturas diferentes (Free lista seis itens, os outros três), então os botões "Upgrade" não se alinham. O seletor Mensal/Anual usa letras de 10–11px em caixa alta, com a explicação em 10px.
Proposta
Planos e taxas
»
Conta ›
Planos e taxas
Planos e taxas
Plano atual:
Free
· Gerenciar assinatura
Mensal
Anual · −17%
Free
Seu plano
$16
$74
$166
botão de expandir dentro da barra · dica no hover · item atual aceso · cartões alinhados
1
O botão de recolher/expandir vira o último item da barra, embaixo, dentro dela, com o mesmo tamanho dos outros ícones. Sem círculo flutuante na borda.
2
Toda entrada recolhida ganha dica ao passar o mouse (title + balão visível após 300 ms) e rótulo para leitores de tela. Ícones sem caixinha, alvo de 44px; o item atual fica com fundo claro e ícone escuro; hover com fundo suave.
3
Grupos recolhidos abrem um menu flutuante ao lado (flyout) em vez de expandir a barra inteira; a busca vira um ícone que abre o campo.
4
Em /account/*, a barra mostra o grupo "Conta" e acende o item atual (hoje essas páginas têm contexts vazio e nunca aparecem).
5
Planos: sai o cartão de abertura; o título compacto ganha ao lado "Plano atual: Free · Gerenciar assinatura", e o seletor Mensal/Anual fica na mesma linha, em 13px sem caixa alta. O chip "Current" no cartão basta — o botão "Your plan" vira texto.
6
Cartões com a mesma altura e botão alinhado embaixo (cartão em coluna flex, botão com margin-top auto). Preço em Manrope 800; a serifa fica para o marketing.
platform/sidebar-toggle.tsx
platform/platform-shell.tsx (SidebarBrand, SidebarToggle, busca)
platform/platform-nav.tsx (PlatformNavLink sem title; toggleSection → onRequestExpand)
globals.css:2696–2712 (rail), 5148–5182 (icon chip)
data/site.ts:268–310 (Account)
app/account/plans/page.tsx · account/plans-panel.tsx
11 · Ordem sugerida
Por onde começar
Do menor para o maior. Os seis primeiros cabem numa única rodada de mudanças; do sétimo em diante, uma rodada por item, sempre conferindo em 375, 768 e 1280px e no tema escuro.
1
Moeda fora do cartão — trocar a coluna de 140px por minmax(0, 200px).
Pequeno.
course-builder-studio.tsx:1949
2
Botão de expandir dentro da barra, dicas nos ícones recolhidos, "Operations" sem acordeão.
Pequeno.
sidebar-toggle.tsx · platform-nav.tsx · globals.css:2708
3
Sino na barra da área de membros.
Pequeno.
member-area-shell.tsx
4
Aula atual no endereço (?aula=) e rolar até o player ao trocar de aula.
Pequeno.
enrolled-course-workspace.tsx:118, 632–665
5
Planos: sem cartão de abertura, plano atual na linha do título, cartões alinhados.
Pequeno.
account/plans/page.tsx · plans-panel.tsx
6
Ops: título compacto, métricas viram contadores, filtros dentro da fila, "Acessos" como fila.
Pequeno a médio.
app/ops/page.tsx · ops-dashboard.tsx
7
Cartão "Próxima aula em 5 s" com cancelar, autoplay e uma etiqueta só de marca d'água.
Médio.
enrolled-course-workspace.tsx · *-player.tsx
8
Playlist ao lado do vídeo; capa só na página inicial do curso; um só botão Concluir.
Médio.
enrolled-course-workspace.tsx · members-area-hero.tsx
9
Abas com endereço (Materiais, Comunidade, Mensagens, Avaliação, Sobre) e redirecionar /learn/community/[slug].
Médio a grande.
app/learn/courses/[slug]/* · course-community-feed.tsx
10
Painel do aluno: "Continuar assistindo" com miniaturas, "Novidades", grade de cursos.
Médio.
learn-dashboard.tsx
11
Meus produtos: tabela com cabeçalho, uma ação + menu ⋯, atalhos no rodapé; criação numa tela.
Pequeno a médio.
teacher-course-studio.tsx · create-course-start.tsx
12
Caixa de mensagens do aluno (/learn/mensagens) e grupo "Conta" na barra lateral.
Médio.
novo · data/site.ts
Leitura estática de
SkillsetMind-app/skillset-foundation
em
main @ 123f95f
, 2 de setembro de 2026. Esquemas redesenhados a partir do código e da captura de tela enviada; nenhuma tela foi medida ao vivo. A versão em Markdown, para colar no repositório e entregar ao agente, acompanha este arquivo.
Versão em Markdown →
Auditoria geral (27 achados)
Fluxo de criação (13 achados)