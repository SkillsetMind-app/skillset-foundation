# DESIGN CLONE SPEC — Estrutura Hotmart → SkillsetMind

> **Data:** 2026-07-14
> **Fonte:** valores CSS reais extraídos da conta autenticada (app.hotmart.com) via eval — leitura apenas.
> **Regra do Patrick:** clonar a ESTRUTURA validada (layout, espaçamento, anatomia de botão, posicionamento, comportamento desktop/mobile). ADAPTAR: cores, tom da mensagem, ícones/emojis/animações. Hotmart = amigável/animado; SkillsetMind = sério/profissional por nicho.
> **NÃO copiar:** marca, textos, ativos gráficos, ilustrações da Hotmart. Só o esqueleto estrutural (não protegível) vira referência.

---

## 1. Design system de origem: "Cosmos" (cds-)

Hotmart roda um DS próprio, prefixo `--cds-*`, **844 tokens**. Base:

| Token | Valor Hotmart | Nossa adaptação (SkillsetMind) |
|---|---|---|
| Fonte base | **Nunito Sans** 16px (arredondada, amigável) | Face séria/editorial (headings pesados). Manter 16px base. |
| Cor de fundo app | `#f7f9fa` (cinza quase branco) | Manter neutro claro; nosso Ink Indigo só em acentos |
| Texto base | `#32363b` | `#14182B` (Ink Indigo) |
| Sidebar bg | `#f8f8f8` | Neutro claro OU indigo escuro (decisão de contraste) |
| Marca primária | `#f04e23` (laranja vibrante) | **`#14182B` Ink Indigo + `#C6A15B` Muted Brass** |
| CTA sólido | `#0d0d0d` (preto) / texto branco | Manter escuro sério (indigo) — combina com nosso tom |
| Positivo/sucesso | `#06af41` verde | Manter verde funcional |
| Negativo | `#e10042` / `#d6342c` | Manter vermelho funcional |
| Breakpoint lg | `1024px` (64rem) | Adotar 1024px |
| Breakpoint xxl | `1700px` | Adotar |

## 2. Anatomia de botão (CLONAR a estrutura)

Valores reais medidos:

| Tipo | Altura | Radius | Padding | Peso | Uso |
|---|---|---|---|---|---|
| CTA sólido escuro | 40px | **6px** | 10px / 16px | 400 | ação primária ("Preencher dados") |
| Botão de card/checklist | 44px | **8px** | 12px / 8px | 400 (ativo 700) | itens de próximo-passo |
| Primário de marca | — | 8px | 8px / 16px | 400 | "Convidar colaborador" |
| Secundário/ghost | — | 0-8px | 8px / 8px | **700** | texto colorido, sem fundo |
| Abas (tab) | — | 0px | 8px / 8px | **700** | "Geral / Hotmart Club" |

**Padrão-chave:** primário = fw 400 (não-bold); secundário/abas = fw 700. Radius 6px (sólido) e 8px (superfícies). → Nós clonamos essas medidas; **ajuste sério**: headings e labels mais pesados (o "leve" deles passa informalidade).

## 3. Escala tipográfica (CLONAR proporções)

| Elemento | Hotmart | Adaptação |
|---|---|---|
| h1 / display | 36px, lh 40px, **fw 400** (leve) | 36px, lh 40px, **fw 600-700** (peso = seriedade) |
| display sm | 30px (1.875rem) | manter |
| h3 | 18px, lh 25px, fw 600 | manter |
| xs | 12px (.75rem) | manter (labels, metadados) |

## 4. Layout — DESKTOP

```
┌──────────────────────────────────────────────────────────┐
│  HEADER (busca, notificações, avatar, "Geral/Club" tabs)  │  z:10
├────┬─────────────────────────────────────────────────────┤
│ R  │  MAIN (fundo #f7f9fa)                                │
│ A  │  ┌─────────────────────────────────────────────┐    │
│ I  │  │ Banner de boas-vindas + checklist ativação  │    │
│ L  │  │ (barra de progresso "33% completo")         │    │
│    │  ├─────────────────────────────────────────────┤    │
│ ic │  │ "Meus produtos" — grid de cards + filtros   │    │
│ on │  │ [Todos][Rascunhos][Vendas ativas][suspensas]│    │
│ -  │  ├─────────────────────────────────────────────┤    │
│ onl│  │ "O que quer vender?" (formatos)             │    │
│ y  │  │ "Minha evolução" (progressão do creator)    │    │
│    │  └─────────────────────────────────────────────┘    │
└────┴─────────────────────────────────────────────────────┘
```

- **Rail lateral icon-only** que expande no hover (revela labels + submenus)
- Main com **cards de radius 8px**, sombra sutil, seções empilhadas
- **Filtros em pills/tabs** acima do grid de produtos
- Barra de progresso de onboarding (nós: onboarding do professor)

## 5. Layout — MOBILE (375px) — comportamento medido

- **HOT-HEADER fixo no topo, 71px, full-width, z:10** → app bar; menu vira **hambúrguer/drawer**
- **Rail lateral colapsa para largura 0** (some) — conteúdo assume **coluna única full-width**
- **Linhas de cards viram carrossel horizontal** (cards ~219px que rolam lateralmente) — regra: em telas < lg, grades de cards viram scroll-x
- **Zero overflow horizontal** (a página nunca rola de lado; só os carrosséis internos rolam) → nossa regra §2.5 de viewport-fit continua valendo
- Overlay de dashboard em z:9999 quando drawer/menu abre

## 6. O que ADAPTAR (tom sério vs. amigável da Hotmart)

| Dimensão | Hotmart | SkillsetMind |
|---|---|---|
| Paleta | laranja vibrante `#f04e23` | Ink Indigo `#14182B` + Muted Brass `#C6A15B` |
| Fonte | Nunito Sans (arredondada) | face editorial séria, headings pesados |
| Ícones | coloridos, "animados" | line-icons sóbrios (Lucide, que já usamos) |
| Emojis | 👋 casual no banner | usar com parcimônia / substituir por selo de verificação |
| Copy | informal ("Falta pouco pra vender!") | consultivo, por nicho ("Prepare seu programa para publicação") |
| Ilustrações | mascotes/desenhos lúdicos | credibilidade: selos, avatares reais, provas |

**Estrutura idêntica, pele diferente.** Clonamos grid, espaçamento, anatomia de botão, posicionamento de filtros, comportamento do rail e do carrossel mobile — e trocamos cor/fonte/ícone/copy pro perfil profissional.

## 7. Onde isso encaixa no nosso código

Nosso `platformNav` (`src/data/site.ts`) + `platform-nav.tsx` + `platform-shell.tsx` já implementam o rail com seções e permissões. As ações de design:
- Ajustar **radius/altura/peso** dos botões pros valores acima (6-8px, 40-44px)
- Confirmar **carrossel horizontal** nas linhas de cards em < lg
- Garantir **app bar fixa 71px + drawer** no mobile (já temos `mobile-sidebar-drawer.tsx` — validar comportamento vs esta referência)
- Aplicar escala tipográfica com **headings mais pesados** que a Hotmart

→ Isso vira uma **passada de design** que acompanha a sessão de código nº 2 (catálogo + sidebar religada), onde a barra lateral já será tocada.
