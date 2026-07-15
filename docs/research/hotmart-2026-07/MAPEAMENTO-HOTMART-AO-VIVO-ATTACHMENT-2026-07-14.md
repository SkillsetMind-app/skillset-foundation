# MAPEAMENTO HOTMART AO VIVO — Painel do Produtor

> **Data:** 2026-07-14 (v2 — sweep profundo dentro das telas de gestão do produto)
> **Método:** conta autenticada (Patrick logou; eu nunca digito credencial). Navegação em modo LEITURA — nada salvo/alterado/criado. Extração via eval de DOM/CSS (print de browser trava — regra anti-fricção nº5).
> **Objetivo:** mapear estrutura real do painel do produtor pra clonar (estrutura validada) na SkillsetMind, adaptando cor/tom/ícone/copy.
> **Complementa:** `HOTMART_PRODUCER_PARITY.md` (auditoria 09/07) + `DESIGN-CLONE-SPEC-HOTMART-2026-07-14.md` (design system). Referência de arquitetura/fluxo — nada de marca, texto proprietário, preço ou ativo copiado.

---

## 1. MENU LATERAL GLOBAL DO PRODUTOR (taxonomia completa, ao vivo)

Rail icon-only que expande no hover. 7 grupos:

| Grupo | Itens |
|---|---|
| **(topo)** | Buscar · Home |
| **Produtos** | Meus produtos · Área de membros · Afiliar-se a um produto |
| **Marketing** | Visão geral · Criação de páginas · E-mail marketing |
| **Vendas** | Gestão de vendas · Minhas vendas · **Gestão de assinaturas** · Gestão de Produtos Físicos · **Gestão do Parcelado Hotmart** · Reembolsos · Emissão de Nota Fiscal (eNotas) |
| **Gestão de recebíveis** | Carteira · Saldo · Extrato · Movimentações do mês · **Saques** · **Antecipações** |
| **Relatórios** | Vendas · **Recorrências** · Minhas análises |
| **Parcerias** | Central de colaboradores · Afiliados · Chat com Afiliados |
| **Ferramentas** | Impulsione suas vendas · Gerencie seu negócio · Ver todas |

### Cruzamento com nosso `platformNav` (src/data/site.ts)

| Hotmart | Nosso | Status |
|---|---|---|
| Home | `/teach` Studio | ✅ |
| Meus produtos | `/teach/builder` | ✅ |
| Área de membros | editor de membros | ✅ |
| Minhas vendas / Gestão de vendas | — | ❌ (Relatórios, sessão 5) |
| **Gestão de assinaturas** | — | ❌ **P1.5** |
| Gestão do Parcelado | — | ❌ Fase 3 (doutrina de taxas) |
| Reembolsos | `/teach/refunds` | ✅ (guard no ar) |
| eNotas (nota fiscal) | — | ⏸ BR-only, pós-US |
| Carteira/Saldo/Extrato/Saques | `/account/payments` + release-payouts | ⚠️ backend existe, visão produtor oculta |
| **Antecipações** | — | ❌ Fase 3 (opt-in, custo real) |
| Relatórios (Vendas/Recorrências/Análises) | — | ❌ sessão 5 (KPIs) |
| Central de colaboradores | `/teach/team` | ⚠️ oculto (`contexts: []`) |
| Afiliados / Chat afiliados | `/teach` config | ⏸ adiado (durante lançamento) |
| E-mail marketing / Criação de páginas | — | ❌ P2 (automações + funil) |

## 2. FORMATOS DE PRODUTO (tela "Criar produto" — /products/add)

**8 formatos** oferecidos:

| Formato | Descrição Hotmart | Nós no lançamento? |
|---|---|---|
| **Curso Online** | aulas vídeo/texto/quiz, materiais, engajamento, certificado | ✅ core |
| **eBook** | .pdf / .ePub | ⏸ fácil P2 |
| **Comunidade** | "conteúdos frequentes para assinantes", renda recorrente | ⏸ (temos community no /learn) |
| **Produto Físico** | estoque/envio | 🚫 fora do escopo |
| **Assinatura** | **"Para curso online e área de membros"** | ❌ **P1.5** (é formato, não toggle) |
| **Evento Online** | conferências, palestras, workshops | ⏸ P2 (temos /events) |
| **Serviço Online** | — | ⏸ Fase 2 (1:1) |
| **Agentes de IA** | Hotmart vende agente como produto | 🚫 nós usamos IA como CONSELHEIRA do criador, não como produto à venda |

> **Decisão confirmada:** Assinatura = formato de produto escolhido na criação → P1.5 é trilho próprio (novo tipo de produto + config de recorrência), não um switch na oferta. Bate 100% com o que foi flagado.

## 3. CENTRAL DO CURSO (/products/manage/{id}) — 11 abas ao vivo

Menu lateral do produto (`nav.manage-menu`):

1. **Painel** (checklist de finalização)
2. **Links de divulgação**
3. **Informações básicas**
4. **Precificação e ofertas**
5. **Área de membros**
6. **Página do produto**
7. **Programa de afiliados**
8. **Coproduções**
9. **Cupons**
10. **Coleta de impostos**
11. **Ferramentas**

+ "Acessar a gestão do curso" (abre o editor de conteúdo do Club) · "Trocar Produto"

### Painel — checklist de publicação (ordem exata, ao vivo)

"Falta pouco para finalizar o cadastro":
- Informações básicas [Editar]
- Precificação e ofertas [Editar]
- Página de Vendas [Editar]
- **Dados pessoais completos [Configurar]** ← gate KYC (nosso: Stripe KYC camada 0)
- Área de Membros [Editar]
- Conteúdo (Opcional) [Configurar]
- **Agente de Vendas (Opcional) [Desativar]** ← IA opt-out, cobra US$2,50/venda
- Programa de afiliados (Opcional) [Configurar]
- Coleta de impostos (Opcional) [Configurar]
- **Finalizar cadastro** (aceita Termo de Tratamento de Dados)

→ **Nosso checklist de publicação** espelha isto, trocando "Dados pessoais/KYC" pela **verificação em camadas** (Stripe→CNPJ→CRP) e removendo o Agente de Vendas cobrado (nossa IA é conselheira, grátis).

## 4. PRECIFICAÇÃO E OFERTAS (/products/manage/{id}/offers) — ao vivo

- **Preço base** editável (ex.: R$497,97) · **"Novo preço"** = multi-oferta por produto
- **Prazo de reembolso** configurável (visto: 7 dias) [Modificar] → Hotmart 7/15/21/30
- Tabela de ofertas, colunas: **Nome · Valor · Código · Forma de pagamento · Recuperador automático · Conversão de moeda · Ações**
- Cada oferta tem **código único** (link de checkout, ex.: `giqyywxn`)
- **Repasse/absorve ao vivo:** *"Parcelado com taxas para seu cliente (seu cliente é quem paga as taxas)"* → o produtor escolhe **repassar** a taxa de parcelamento ao comprador OU absorver
- **Recuperador automático** (dunning/retentativa) por oferta — toggle Ativo/Inativo
- **Conversão de moeda** por oferta
- "Configurar checkout" → `/tools/checkout/settings`: "1 clique (otimizado)" OU "Editar manualmente"

→ **Nosso checkout (Stripe):** multi-oferta + reembolso configurável + repasse/absorve de parcelamento (doutrina de taxas) + dunning + multi-moeda (já temos wallet 30+ moedas). O schema de "oferta" deve espelhar essas colunas.

## 5. DESIGN SYSTEM — resumo (detalhe em DESIGN-CLONE-SPEC)

- DS próprio **"Cosmos"** (`--cds-*`, 844 tokens); fonte **Nunito Sans** 16px; marca laranja `#f04e23`
- Botões radius 6-8px, altura 40-44px; h1 36/40 fw400 (leve)
- **Mobile:** sidebar → drawer; app bar fixa 71px; coluna única; cards viram carrossel horizontal; zero overflow-x
- **Nossa pele:** Ink Indigo `#14182B` + Muted Brass `#C6A15B`; headings pesados; line-icons Lucide; copy consultiva; selos no lugar de emoji casual

## 6. NÃO ABERTO (baixo valor marginal — já no mapa 09/07)

Área de membros (editor), Página do produto (block editor), Cupons, Coproduções, Programa de afiliados (config), Gestão de assinaturas global (precisa de produto-assinatura ativo). Todos descritos no `HOTMART_PRODUCER_PARITY.md`. Abrir sob demanda.

---

## 7. VEREDITO PRO PLANO DE CÓDIGO

Nada muda no plano — só **confirma e enriquece**:
1. **Modo lançamento + tripwire vídeo** (sessão 1)
2. **Catálogo 8 cat + sidebar religada** (`contexts: []` → `["teacher"]` p/ Cupons/Coproduções/Equipe/Integrações/Payouts) **+ passada de design** (radius/altura/peso/drawer conforme Cosmos, pele nossa) (sessão 2)
3. **Founding Pass US$497** (sessão 3)
4. **Founding Builder + sell-gate/verificação** (sessão 4)
5. **Painel professor: IA conselheira (DeepSeek+n8n, backend novo) + KPIs + checklist de publicação + evolução do creator** (sessão 5)
6. **P1.5 Assinatura como formato de produto** (config de recorrência: periodicidade, nº cobranças, trial, garantia 1ª cobrança, 5 atrasos=cancela) — trilho próprio, ~2-3 sessões

Schema de "oferta" (multi-preço, código, repasse/absorve, dunning, moeda, reembolso) = espelhar colunas da Hotmart no nosso checkout Stripe.
