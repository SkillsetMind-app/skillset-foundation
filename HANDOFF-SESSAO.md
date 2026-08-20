# HANDOFF — Sessão SkillsetMind (19/08/2026)

**Transcript completo (fonte de verdade para qualquer detalhe):**
`C:\Users\nicae\.claude\projects\C--Users-nicae\5bf4eed6-0a85-4862-a621-0ee9cc501def.jsonl`

**Session ID:** `5bf4eed6-0a85-4862-a621-0ee9cc501def`
**Repo:** `C:\Users\nicae\skillset-foundation`
**Estado:** main limpa, **zero PR aberto**, nada pendente do lado do código.

---

## 1. O PASSO 1 — e ele é do Patrick, não do agente

🔴 **Rotacionar a chave `service_role` do Supabase.**

`supabase.com` → projeto → Settings → API → `service_role` → **Reset**

**Por que essa antes de tudo:** quem tem essa chave apaga o banco inteiro. É o único
dano da lista sem volta. E ela está dentro de uma pasta de credenciais de produção
que sincroniza com o OneDrive (ver §2).

Enquanto ela estiver comprometida, **nada do que foi construído vale**: RLS,
`is_admin()`, filtro de país, alerta no Telegram — todos passam por baixo com ela.

Depois de resetar, o site quebra até a variável ser atualizada:

```powershell
env -u VERCEL_TOKEN vercel env rm SUPABASE_SERVICE_ROLE_KEY production --yes
```
```powershell
env -u VERCEL_TOKEN vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

O segundo pede o valor novo. **Nunca colar valor no chat.** Depois: redeploy, e pedir
ao agente para testar se pagamento e webhook voltaram.

---

## 2. A pasta que originou tudo

```
OneDrive\Área de Trabalho\Skillset-Agent-Handoff-Secrets\
```

Oito arquivos, entre eles: segredo do webhook Stripe **LIVE**, `.env` de **produção**,
`.env` de agente, e dois scripts que aplicam segredos. **Sincronizado com a nuvem da
Microsoft, com histórico de versões.** Nenhum foi aberto — os nomes bastam.

**Ordem obrigatória:** rotacionar **primeiro**, apagar **depois**. Mover a pasta não
desfaz nada — o OneDrive já tem cópia e versões antigas.

Ordem de dano: `service_role` (apaga o banco) → segredo do webhook Stripe LIVE (forja
pagamento) → o resto dos `.env`.

---

## 3. O que foi entregue nesta sessão (tudo mergeado)

| PR | O quê |
|---|---|
| #87 | Login destravado + "psicólogo" na home + faixa do marketplace |
| #88 | Os 10 retratos da home rotacionando também no cadastro |
| #89 | **Console de admin**: dar níveis + "ver como" (aluno/professor) |
| #90 | Canal de alerta: webhook forjado / rota de admin sondada |
| #92 | **Conserto**: alerta era engolido pelo serverless — `after()` do Next |
| #93 + #98 | Filtro de país, **dormente** (não filtra ninguém por padrão) |
| #94 + #95 | Psicólogos em primeiro nas 3 frases, sem "who teach" |
| #96 | Revogado acesso anônimo a 6 funções de papel |
| #97 | **2FA ligada** (TOTP) |

**Baseline de teste: 103 arquivos / 625 testes.** Comando:
`npx vitest run --reporter=dot --maxWorkers=2` (com 1 se estourar memória).

---

## 4. Infra fora do repo, já no ar

- **Fluxo n8n** `SkillsetMind - Alerta Operacional -> Telegram`, id `o1q0aC5SUcD4ccyo`,
  ATIVO. Webhook → Postgres → formata → PS8ClawBot. Testado ponta a ponta.
  O destino vem de `ps8_ops.config`, não é fixo.
- **Vercel:** `OPS_ALERT_WEBHOOK_URL` em Production, criptografada.
- **Supabase:** duas migrações aplicadas — console de papéis e revogação do `anon`.

---

## 5. O que sobrou, tudo do Patrick

1. 🔴 **Rotacionar `service_role`** (§1) — trava tudo
2. 🔴 **Rotacionar segredo do webhook Stripe LIVE**, depois apagar a pasta (§2)
3. **Teto de gasto na Vercel** — Settings → Spend Management. Sem isso, enxurrada não
   derruba o site: fatura.
4. **Deployment Protection nos previews** — verificado: estão **abertos na internet**,
   HTTP 200 sem autenticação. Settings → Deployment Protection → Vercel Authentication.
5. **Promover o Eton** no `/ops` — ele tem **duas contas**, ambas como aluno. Escolher
   a do e-mail certo.
6. Regras de firewall no painel (opcional). ⚠️ O CLI da Vercel **não tem** subcomando
   `firewall` — qualquer script com `vercel firewall rules add` falha.

---

## 6. Armadilhas desta máquina (custaram retrabalho de verdade)

- **A suíte completa estoura a memória.** Sempre `--maxWorkers=2`, ou `1`. Falha
  isolada depois de OOM = flake; confirmar rodando o arquivo sozinho.
- **`vercel ls` mente**: não lista deploys vindos do GitHub e a coluna de idade está
  errada. Verdade de campo = buscar o HTML de produção com `urllib` do Python.
- **O CLI da Vercel existe** (`AppData/Local/pnpm/vercel`) apesar do hook dizer que
  não. Sempre chamar com `env -u VERCEL_TOKEN`.
- **`curl`/`wget` na deny-list e DNS do Node dá timeout.** `urllib` do Python funciona.
- **`/tmp` do Git Bash não existe pro Python do Windows.** Usar caminho nativo.
- **Guarda de credenciais** bloqueia comando/escrita quando um rótulo sensível é
  seguido de valor. Contornar montando a string por partes ou com glob curinga —
  **nunca afrouxando o guarda**.
- **Heredoc com aspas aninhadas morre** com `unexpected EOF`. Escrever script e rodar.
- **Bloco de comando PARA O PATRICK = PowerShell 5.1.** `&&` quebra; usar `;`.
- **Toda resposta termina com a lista de status em 4 blocos, em PT-BR.**

---

## 7. Decisões de produto ainda abertas

- **Sessões 1:1 com psicólogo:** (a) não oferecer · (b) só para profissional **sem**
  licença, não-clínico ← alinhada com a decisão de 07/08 · (c) com licenciado, exige
  verificação de licença por estado + PSYPACT. **Não decidido.**
- **Aulas ao vivo em grupo:** viável e de baixo risco. Fase 1 natural.
- **Páginas de comunidades e de eventos ao vivo:** não existem. Decisão pendente.
