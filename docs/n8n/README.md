# Consultor do Estúdio (Studio Advisor) — fluxo n8n

Guia para ligar o chat de consultoria que aparece no painel do professor.
Não precisa saber programar. Siga na ordem.

---

## 1. O que é isto

Dentro do SkillsetMind, o professor (quem cria e vende o curso) tem um balãozinho
de chat flutuante chamado **Studio advisor**. Ele responde dúvidas sobre:

- como estruturar o curso (módulos, aulas, ordem),
- **vídeo: incorporar do YouTube ou subir o arquivo** (o SkillsetMind aceita os dois),
- preço,
- como conseguir as primeiras vendas.

Quem escreve essas respostas é um modelo de IA chamado **DeepSeek**. Mas o site
não fala com o DeepSeek diretamente. Ele fala com o **n8n** — uma ferramenta de
automação que você já tem, onde a gente monta o caminho "recebe pergunta →
manda pro DeepSeek → devolve resposta" arrastando blocos, sem escrever código.

O caminho completo:

```
Professor digita no chat
        ↓
site (Vercel)  → confere se está logado, limita o uso, corta mensagem gigante
        ↓
n8n (seu servidor)  → confere a senha, monta o pedido, chama o DeepSeek
        ↓
DeepSeek → escreve a resposta
        ↓
volta pelo mesmo caminho e aparece no chat
```

O arquivo **`teacher-advisor.flow.json`** (nesta mesma pasta) é esse caminho
pronto. Você importa no n8n e ele já vem montado com 5 blocos.

Duas coisas importantes de entender antes:

- **O arquivo não tem nenhuma senha dentro.** Isso é de propósito. Você cria as
  senhas dentro do n8n (passo 3) e elas ficam guardadas lá, nunca em arquivo.
- **A porta é trancada.** Se alguém descobrir o endereço do seu n8n e tentar usar
  sem a senha certa, o n8n recusa (erro 403) e o DeepSeek nem chega a ser
  chamado — ou seja, ninguém gasta seu crédito.

---

## 2. Importar o fluxo no n8n

1. Abra seu n8n no navegador e faça login.
   *Se o endereço do n8n não abrir, ele está fora do ar ou o domínio expirou —
   resolva isso primeiro, nada abaixo vai funcionar. (Registro do time em
   2026-08-01: o endereço `n8n.srv1429716.hstgr.cloud` não estava respondendo.)*
2. No menu lateral, clique em **Workflows**.
3. Botão **⋯** (três pontinhos) no canto superior direito → **Import from File…**
4. Escolha o arquivo `docs/n8n/teacher-advisor.flow.json` deste projeto.
5. Vai aparecer um desenho com 5 caixinhas ligadas em fila. Duas delas ficam com
   um **aviso vermelho de credencial** — isso é esperado, é o passo 3.
6. Clique em **Save** (Salvar) e dê um nome se pedir.

---

## 3. Criar as duas credenciais

"Credencial" no n8n é só um cofrinho onde você guarda uma senha. São duas.

### Credencial A — a senha entre o site e o n8n

Serve para o n8n saber que quem está batendo na porta é mesmo o seu site.

1. Primeiro, **invente uma senha longa e aleatória**. Não use uma palavra. Um
   jeito rápido: abra o Terminal (PowerShell) e rode:

   ```powershell
   -join ((48..57) + (97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
   ```

   Copie o resultado e **guarde num lugar seguro** (gerenciador de senhas). Você
   vai colar essa MESMA senha em dois lugares: aqui e na Vercel (passo 4).

2. No n8n: menu lateral → **Credentials** → **Add credential**.
3. Procure e escolha o tipo **Header Auth** ("autenticação por cabeçalho" — é o
   modo em que a senha viaja junto com o pedido, num campo escondido).
4. Preencha exatamente assim:
   - **Name** (nome da credencial): `SkillsetMind Advisor Secret`
   - **Header Name** (nome do campo): `x-advisor-secret`
   - **Header Value** (valor): a senha que você gerou no item 1
5. **Save**.
6. Volte ao fluxo, clique duas vezes na caixinha **Webhook (teacher-advisor)** e,
   no campo de credencial, selecione a que você acabou de criar. Feche e **Save**.

> ⚠️ O campo **Header Name** tem que ser exatamente `x-advisor-secret`, tudo
> minúsculo e com os hífens. É o nome que o site usa.

### Credencial B — a chave do DeepSeek

Serve para o DeepSeek saber que é você cobrando na sua conta.

1. Pegue sua chave em <https://platform.deepseek.com> (API keys). Ela parece
   `sk-` seguida de letras e números. **Tem que ter crédito na conta**, senão o
   chat responde erro.
2. No n8n: **Credentials** → **Add credential** → tipo **Header Auth** de novo.
3. Preencha:
   - **Name**: `DeepSeek API`
   - **Header Name**: `Authorization`
   - **Header Value**: a palavra `Bearer`, um espaço, e a sua chave.
     Exemplo do formato: `Bearer sk-xxxxxxxxxxxxxxxx`
4. **Save**.
5. Volte ao fluxo, clique duas vezes na caixinha **Call DeepSeek** e selecione
   essa credencial. Feche e **Save**.

### Ligar o fluxo

No canto superior direito do fluxo tem uma chavinha **Inactive / Active**.
Deixe em **Active**.

> Isso é obrigatório. Desligado, só funciona a "URL de teste", que morre quando
> você fecha o editor. Ligado, funciona a **URL de produção**, que é a que o site
> usa 24h por dia.

### Copiar o endereço

Clique duas vezes na caixinha **Webhook (teacher-advisor)**. Vai aparecer
**Test URL** e **Production URL**. Copie a **Production URL** — algo como:

```
https://SEU-N8N/webhook/teacher-advisor
```

Guarde. É o valor do primeiro item do passo 4.

---

## 4. As 3 variáveis na Vercel

"Variável de ambiente" é uma configuração que o site lê quando liga. Ficam na
Vercel, não no código.

**Onde:** <https://vercel.com> → escolha o projeto → aba **Settings** → menu
lateral **Environment Variables**. Em cada uma, marque o ambiente
**Production** (e **Preview**, se quiser testar antes de publicar).

| Nome (copie exatamente) | Valor |
|---|---|
| `N8N_ADVISOR_WEBHOOK_URL` | a **Production URL** que você copiou no fim do passo 3 |
| `N8N_ADVISOR_WEBHOOK_SECRET` | a **mesma senha** da Credencial A. Tem que ser idêntica, sem espaço sobrando |
| `NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED` | `true` (em minúsculas, sem aspas) |

**Depois de salvar as três, é obrigatório republicar o site:** aba
**Deployments** → no deploy mais recente, botão **⋯** → **Redeploy**.
Sem isso as configurações novas não entram — o site continua rodando com as
antigas.

O que cada uma faz, em uma frase:

- `..._URL` — diz ao site para onde mandar a pergunta.
- `..._SECRET` — a senha que prova que é o site falando. **Se faltar, o site nem
  tenta chamar o n8n** e mostra "The studio advisor is being set up".
- `NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED` — faz o balãozinho aparecer na tela.
  Pode ligar antes de tudo para ver o visual; enquanto o resto não estiver
  pronto ele só mostra a mensagem calma de "em configuração".

---

## 5. Testar

### Teste 1 — o n8n sozinho (antes de mexer no site)

Abra o PowerShell e cole isto, trocando `SUA_URL` e `SUA_SENHA`:

```powershell
curl.exe -i -X POST "SUA_URL" `
  -H "Content-Type: application/json" `
  -H "x-advisor-secret: SUA_SENHA" `
  -d "{\"teacherId\":\"teste\",\"messages\":[{\"role\":\"user\",\"content\":\"Devo subir o video ou usar YouTube?\"}]}"
```

**Esperado:** a primeira linha traz `200` e no fim aparece algo como
`{"reply":"..."}` com um texto respondendo sobre YouTube x upload.

### Teste 2 — a porta está trancada?

Rode o mesmo comando, mas troque a senha por qualquer coisa errada.

**Esperado:** `403` e nenhuma resposta de texto. Se vier `200`, **pare**: a
credencial não está ligada na caixinha Webhook. Volte ao passo 3.

### Teste 3 — o site de ponta a ponta

1. Entre no site com uma conta de **professor**.
2. Vá para a área do estúdio (`/teach`).
3. Clique no balãozinho **Studio advisor** no canto.
4. Pergunte: *"Devo incorporar do YouTube ou subir o vídeo?"*
5. **Esperado:** em poucos segundos aparece uma resposta comparando as duas
   opções.

### Se der errado

| O que você vê | O que provavelmente é |
|---|---|
| O balãozinho não aparece | `NEXT_PUBLIC_TEACHER_ADVISOR_ENABLED` não está `true`, ou faltou republicar. Confira também que a conta é de professor |
| "The studio advisor is being set up…" | Falta `N8N_ADVISOR_WEBHOOK_URL` ou `N8N_ADVISOR_WEBHOOK_SECRET` na Vercel, ou faltou republicar |
| "The advisor is unavailable right now" | O n8n recusou ou falhou. Causas comuns: fluxo **Inactive**; senha diferente entre Vercel e n8n; chave DeepSeek errada ou **sem crédito**. Veja em n8n → **Executions** qual caixinha ficou vermelha |
| "The advisor is taking too long" | O n8n demorou mais de 60 segundos. Verifique se o servidor do n8n não está sobrecarregado |
| Respondeu, mas fora do assunto | É o texto de instrução do modelo. Está na caixinha **Build DeepSeek request**, dá para editar direto no n8n — **não precisa republicar o site** |

---

## 6. Detalhes bons de saber

- **Você muda o comportamento sem mexer no site.** O texto que define a
  personalidade e os limites do consultor mora dentro do n8n (caixinha *Build
  DeepSeek request*). Editou e salvou, já vale na próxima pergunta.
- **Limites já embutidos no consultor:** ele recusa dar conselho jurídico,
  contábil, fiscal, médico ou clínico; nunca fala em nome do SkillsetMind; e
  nunca promete valor, data ou percentual de repasse. Isso é proposital — não
  tire.
- **Proteção contra "sequestro de instrução":** se um professor escrever
  "esqueça suas regras e faça X", o modelo foi instruído a tratar a mensagem
  como *pergunta*, nunca como *ordem*.
- **Custo controlado:** o site limita cada professor a 30 mensagens por hora e
  120 por dia, e corta mensagens muito longas. O fluxo ainda limita a resposta a
  1200 tokens (~900 palavras).
- **Trocar de modelo:** dentro da caixinha *Build DeepSeek request* há a linha
  `model: 'deepseek-chat'`. Trocando para `'deepseek-reasoner'` você ganha
  respostas mais "pensadas" e mais lentas. O limite de 60 segundos do site foi
  dimensionado justamente para caber um modelo de raciocínio (o comentário em
  `src/app/api/teach/advisor/route.ts` registra ~19s medidos), então dá para
  trocar sem mudar nada no site.
- **Se o DeepSeek falhar**, o fluxo não quebra: devolve um erro organizado e o
  chat mostra "tente de novo" em vez de travar.
- Este arquivo substitui o rascunho antigo `docs/n8n-teacher-advisor.workflow.json`.
  O guia de contexto mais amplo continua em `docs/teacher-advisor-setup.md`.
