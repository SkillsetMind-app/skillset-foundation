# Defesa da plataforma — o que temos, o que não temos, e os robôs

Levantado em 30/08/2026, medindo o código e o banco, não a memória.

---

## A conclusão primeiro

**A ordem importa mais que a tecnologia.** Hoje o segundo fator de autenticação é contornável, o limite de tentativas público é burlável, e não há detecção de robô nenhuma. Colocar agentes de IA vigiando por cima disso é alarme numa casa de porta destrancada: bonito no papel, inútil na prática, e pior — dá a sensação de estar protegido.

Os robôs vêm, e eu desenho eles abaixo. Mas eles são a **terceira** camada, não a primeira.

---

## 1. O que temos hoje

| Defesa | Estado real | Vale quanto |
|---|---|---|
| **Filtro de país nas portas sensíveis** | Existe, bem escrito, **desligado por decisão sua** (`GEO_ALLOWED_COUNTRIES` vazio) | Filtro de ruído, nunca muro — o próprio código diz isso. Um VPN nos EUA passa reto |
| **Cabeçalhos de segurança** | CSP, anti-clickjacking, anti-sniffing, HSTS | Sólido. O HSTS eu consertei hoje |
| **Limite de tentativas no banco** | Existe e é usado em várias rotas | **Burlável na verificação pública** (consertei em migration, falta aplicar) |
| **Teto de uso do advisor** | Existe | **Não limita nada** — checa antes de um `await`, achado A-29 |
| **CAPTCHA** | Código em 5 arquivos, **desligado** desde o apagão de login de 26/08 | Zero hoje. E religar quebra a troca de senha (achado A-25) |
| **Segundo fator (MFA)** | Construído e ligado | **Decorativo**: o cookie de sessão é gravado antes do código. Quem tem a senha entra |
| **Varredura de segredos no CI** | Existe | Varria **zero commits** no push e no cron. Consertei hoje |
| **Análise estática (Semgrep) e auditoria de dependências** | Rodam a cada PR, verdes | Funcionando de verdade |
| **Isolamento de dados (RLS)** | Existe, com 4 testes | Os testes **nunca rodaram**. Criei o executor hoje; falta você apontar um banco |
| **Alerta de operação** | `notifyOps` no código, vigia no n8n | Funciona, mas o webhook aceita chamada anônima (memória, item aberto) |
| **Auditoria de ações administrativas** | Grava quem mudou papel de quem | Bem feito |

**O que está genuinamente bom:** os cabeçalhos, o Semgrep, o log de auditoria, e — a surpresa da auditoria — as funções administrativas do banco, que barram por dentro apesar do que o alerta automático sugere.

## 2. O que não temos

**Detecção de robô: zero.** Nenhum arquivo do projeto usa qualquer coisa do tipo. A Vercel oferece isso nativamente (BotID), com um modo que não exige nada do visitante. Hoje um script que preenche o formulário de cadastro mil vezes é indistinguível de mil pessoas.

**Firewall de aplicação: nada declarado.** Nenhuma regra em nenhum arquivo de configuração. A Vercel tem WAF e um "modo ataque" que é gratuito em qualquer plano — nada disso está ligado.

**Um lugar para olhar quando algo acontece.** Não existe painel, alerta de anomalia, nem qualquer sinal que dispare sozinho. Se alguém começar a enumerar certificados agora, ninguém fica sabendo. Eu só descobri o furo porque fui ler a função.

**Backup do banco.** O plano gratuito do Supabase não faz backup automático. Não confirmei se vocês subiram de plano.

**Bloqueio por tentativa de senha.** Não há travamento de conta nem atraso progressivo após N erros.

**Conferir:** o plano da Vercel do time `skillsetmind`. O guarda de credenciais me bloqueou de ler o token da CLI — é uma olhada de um clique no painel. Isso decide quantas regras de firewall vocês podem ter (3 no gratuito, 40 no pago) e se o uso comercial está regular.

## 3. O que precisa ser elaborado, em ordem

**Primeiro as fechaduras (dias, não semanas):**

1. Aplicar as 2 migrations que escrevi hoje
2. **Fazer o MFA valer** — exigir o segundo fator antes de a sessão virar utilizável, e no mínimo para as rotas administrativas
3. **Ligar o BotID da Vercel** nas portas: cadastro, login, checkout, verificação de certificado
4. **Ligar o WAF** com o básico: limite por IP nas mesmas portas
5. Apontar um banco de teste para os testes de RLS rodarem no CI

**Depois a visibilidade (o pré-requisito dos robôs):**

6. Um lugar onde os eventos ficam: tentativas de login falhas, matrículas sem pagamento, reembolsos, mudanças de papel, picos por IP. Sem isso, não há o que um agente vigie
7. Backup do banco com restauração testada — backup nunca testado não é backup

**Só então os robôs.**

---

## 4. Os robôs de defesa

A ideia certa não é "uma IA que bloqueia ataque em tempo real" — isso é o que WAF e detecção de robô já fazem melhor, mais rápido e mais barato. O valor da IA aqui é outro: **você é um operador só, e a plataforma gera mais sinal do que uma pessoa consegue ler.**

Quatro agentes, em ordem de retorno:

### Robô 1 — O auditor que não esquece *(o de maior retorno, e o mais fácil)*

É literalmente o que fiz hoje, num relógio. Toda semana: varre o código, o banco e o CI; compara com a auditoria anterior; e **só te chama se apareceu coisa nova**.

Por que é o melhor: os 9 bugs de 26/08 ficaram 4 dias vivos porque ninguém reabriu a lista. Um agente que roda sozinho e cobra o delta resolve exatamente isso. E o portão de integridade que escrevi hoje (todo achado ancorado em arquivo e linha reais) já impede que ele invente achado.

Custo: uma rodada semanal. Já tenho a máquina montada.

### Robô 2 — O caça-anomalia no dinheiro

Roda de hora em hora contra o banco e procura o que **não deveria existir**:

- matrícula ativa sem pagamento correspondente
- reembolso sem revogação de acesso
- assinatura cancelada com aluno ainda entrando
- pico de chaves novas na tabela de limites (o ataque que descrevi hoje)
- curso cujo preço nas colunas antigas discorda das ofertas

Cada uma dessas é uma consulta simples. O papel da IA não é achar — é **julgar se é ataque ou vida normal**, e escrever o alerta em português para você entender no celular.

### Robô 3 — O porteiro do PR

Um agente que entra em todo PR que toca dinheiro, sessão ou política de acesso, e responde uma pergunta: *"isto abre alguma porta?"*. Não substitui o Semgrep — o Semgrep pega padrão conhecido, o agente pega a lógica errada.

Hoje isso teria pego a moeda sem validação e o `base` sem `head`.

### Robô 4 — O triador de incidente *(só depois do item 6 acima)*

Quando existir um lugar com os eventos, um agente lê o fluxo e separa "barulho" de "isso é um ataque". Sem o item 6, ele não tem o que ler.

---

## O que os robôs NÃO fazem

Vale escrever para ninguém se enganar depois:

- **Não param um ataque em andamento.** Quem para é o WAF e o detector de robô, na borda, em milissegundos. Um agente pensa em segundos — tarde demais
- **Não substituem uma fechadura.** Robô olhando um MFA contornável só descreve o roubo com mais eloquência
- **Não são de graça.** Cada rodada custa. O Robô 1 semanal é barato; um agente lendo cada requisição seria caro e inútil
- **Podem ser enganados.** Um agente que lê texto vindo de fora (comentário, nome de curso, e-mail) pode receber instrução plantada ali. Toda entrada de usuário que chega num agente é dado, nunca ordem — e isso precisa estar no desenho desde o primeiro dia

---

## Se você fizer só três coisas

1. Aplicar as duas migrations
2. Fazer o segundo fator valer de verdade
3. Ligar o BotID e o WAF da Vercel nas quatro portas

Isso muda o patamar mais do que qualquer robô. Feito isso, o Robô 1 é uma tarde de trabalho e passa a te avisar sozinho — que é o que falta hoje.
