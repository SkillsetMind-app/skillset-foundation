# Plano de Arquitetura — Área de Membros do Professor + Vitrine do Aluno

> **Status:** ESTUDO (não executar) · **Data:** 2026-06-23 · **Branch base:** `fix/payment-subscription-and-demo-cta`
> **Origem:** consultoria de arquitetura fundamentada no código real + benchmark Hotmart/Kajabi/Teachable/Thinkific/MemberKit/Cademí/Circle.
> **Decisões travadas pelo dono:** (1) **instrutor = marca** (instructor-as-tenant); (2) **modo estudo** — planejar antes de codar.

---

## 1. Objetivo

Permitir que o **professor** configure um espaço editável (a "área de membros" dele) e que o **aluno** veja uma **vitrine configurável** — seguindo o padrão das plataformas de curso/membership, sem clonar a Hotmart inteira.

## 2. Veredito (resumo)

**No caminho certo, com uma correção de rota grande.** O padrão universal "duas superfícies" (vitrine pública ↔ área de membros privada, ligadas pela matrícula) **já está ~70% implementado** no Skillset. O risco real não é fazer errado — é **fazer demais** (domínio próprio, escola multi-tenant, white-label). **Construir a costura fina, não uma segunda plataforma.**

## 3. Decisões travadas

| Decisão | Escolha | Por quê |
|---|---|---|
| Raiz do tenant | **Instrutor = `users/{uid}`** (reuso de `publicProfiles/{uid}`) | Mecanismo de projeção anon-readable já existe; zero infra de multi-tenant. **Sem** collection `School`. |
| Modelo de superfícies | **Separate-surfaces** (Kajabi/Teachable/Thinkific) | O app já tem público (`/courses`, `/instructors`) e privado (`/learn`) separados; forçar "vendas dentro da área de membros" (modelo Hotmart) seria regressão. |
| Tema/branding | Override de **CSS custom properties** com escopo | O app já tematiza 100% por `--color-*`; branding vira troca de token em runtime, não redesign. |

## 4. O que JÁ existe — NÃO reconstruir

| Capability | Onde vive |
|---|---|
| Vitrine pública / catálogo | `src/components/courses/course-marketplace.tsx` (`/courses`) |
| Página de vendas do curso | `src/components/courses/creator-course-detail.tsx` (`/courses/[slug]`) |
| Área de membros (consumo) | `src/components/learn/enrolled-course-workspace.tsx` (`/learn/courses/[slug]`) |
| Home do aluno | `src/components/learn/learn-dashboard.tsx` (`/learn`) |
| Professor edita conteúdo | `src/components/teacher/course-builder-studio.tsx` (~2.694 linhas) |
| Preview da área de membros p/ professor | `/teach/builder/[courseId]/preview` (já shippado, P6-ADD-12/13) |
| Portão de acesso | `Enrollment` (`src/domain/enrollment.ts`) |
| Perfil público do instrutor | `src/components/instructors/instructor-profile-view.tsx` (`/instructors/[slug]`) |

## 5. O gap REAL (fino)

Falta a **camada "instrutor-como-marca"**:
- Branding hoje é **CSS var fixo da plataforma** (zero token controlado pelo professor).
- Não há **rota pública que junte a marca de UM professor + todos os cursos dele** numa página só.
- `PublicProfile` é mínimo (`uid, displayName, username, photoURL, bio, credentials[]`) — não carrega branding nem ordenação de showcase.

## 6. Modelo de dados

Hierarquia canônica das plataformas: `SITE/ESCOLA → PRODUTOS/CURSOS → MÓDULOS → AULAS`. No Skillset o **instrutor É a raiz da marca**, então:

```
users/{uid}                         (REUSO) raiz do tenant; privado, editável pelo professor
  └─ storefrontConfig               (NOVO, embutido)
       ├─ branding { accentColor, logoUrl, heroImageUrl, themePreset }
       └─ showcase  { orderedCourseIds[], featuredCourseId, sectionLabels[] }

publicProfiles/{uid}                (REUSO) projeção anon-readable; widened p/ incluir subset do branding/showcase
TeacherCourse (ownerId)             (REUSO) o nó produto; já chaveado por ownerId
Enrollment (userId__courseSlug)     (REUSO) o portão de acesso; inalterado
LessonProgress                      (REUSO) substrato de resume/continue
```

**Sem** abstração de Offer (multi-oferta por produto, estilo Kajabi) no v1 — `TeacherCourse` já carrega preço inline. Diferenciador, não table-stakes.

## 7. As três superfícies

| Superfície | Acesso | Rotas | Estado |
|---|---|---|---|
| **PÚBLICO (vitrine/vendas)** | anon | `/courses`, `/courses/[slug]`, **`/instructors/[slug]` ← upgrade p/ storefront branded** | reuso + 1 upgrade |
| **PRIVADO (área de membros)** | auth + `Enrollment` | `/learn`, `/learn/courses/[slug]`, `/learn/community`, `/learn/credentials` | já existe |
| **CONFIG DO PROFESSOR** | auth + `teacherStudio` | `/teach/builder` (conteúdo), **`/teach/storefront` ← NOVO (branding+showcase)**, `/teach/builder/[courseId]/preview` | reuso + 1 aba nova |

## 8. Plano faseado

### Fase 0 — Destravar e aterrissar trabalho em voo
- **Goal:** Bash funcionando + Fase 1 (notificações, já escrita) gated/commitada/deployada.
- **Escopo:** reiniciar a CLI (limpar blocker line-118), rodar `npm run lint` / `build` / `--prefix functions build` / `test` / `test:rules`, commit, `deploy:full`.
- **Pronto quando:** sino de notificações deixa de ter `unreadCount=0` hardcoded; gates verdes em produção.
- *Pré-requisito para qualquer fase com npm/deploy.*

### Fase 1 — `StorefrontConfig` + editor do professor
- **Goal:** professor consegue salvar branding + ordenação de cursos.
- **Escopo:** campos `storefrontConfig` em `UserProfile` (`src/domain/user-profile.ts`); aba `/teach/storefront`; regra `firestore.rules` permitindo o dono escrever o próprio config; permissão `teacherStudio.manageStorefront` em `lib/permissions`.
- **Reusa:** padrão de `profile-settings-panel.tsx`, modelo de permissão do preview.
- **Pronto quando:** config persiste e relê; nada renderiza em público ainda (aditivo puro).

### Fase 2 — Projetar p/ público + montar a vitrine do aluno
- **Goal:** `/instructors/[slug]` vira a vitrine branded com a grade de cursos do professor.
- **Escopo:** ampliar `syncPublicTeacherProfile` (`functions/src/index.ts`) p/ projetar o subset de branding/showcase em `publicProfiles/{uid}`; query `ownerId`-scoped em `published-courses.ts`; upgrade de `instructor-profile-view.tsx` (hero branded + grade reusando cards do marketplace).
- **Pronto quando:** aluno abre `/instructors/[slug]` e vê marca do professor + todos os cursos dele numa página só. Sem collection nova.

### Fase 3 — Pass de theming (override de CSS var com escopo)
- **Goal:** vitrine (e opcionalmente o workspace `/learn`) respeita `accentColor`/`logo` do professor.
- **Escopo:** override de `--color-accent`/`--color-brand` num wrapper com escopo; fallback p/ default da plataforma quando não há config.
- **Pronto quando:** vitrine fica levemente branded; zero regressão no player.

### Fase 4 — Gaps reais de aprendizado (paralelizável)
- **Goal:** fechar table-stakes que a reconciliação marcou como genuínos.
- **Escopo:** (a) **video resume** (`lastPosition`: campo de domínio + helper Firestore + rules + wiring no player); (b) **certificado PDF de verdade** (trocar `window.print()` por lib de PDF — precisa `npm install`, logo Bash); (c) **upsell curso→curso** (espelha o upsell→área-de-membros da Cakto). *Quiz/assessment é build grande separado — milestone próprio.*

## 9. Riscos

1. **Scope-creep p/ clone-Hotmart** — domínio próprio (CNAME/DNS), escola multi-tenant, white-label, app nativo são **diferenciais**, não table-stakes. Sinalizar explicitamente qualquer deriva (regra anti-scope-creep ativa).
2. **Branding em projeção pública = superfície de confiança** — `logoUrl`/`heroImageUrl` novos precisam de sanitização igual à já feita com `photoURL` (`firestore.rules:290`). E o **leak de paywall** (conteúdo de aula world-readable) **ainda está aberto** — não empilhar render público sobre paywall que vaza.
3. **Bash bloqueia tudo que precisa de npm/deploy** — Fases 0 e 4.
4. **Type drift existente** — `PayoutLedgerEntry` (domain) vs `PayoutLedgerRecord` (functions). Mexer em `syncPublicTeacherProfile` toca functions → revalidar o contrato de tipo de `PublicProfile`.

## 10. Decisões em aberto (resolver antes da Fase 2)

| Decisão | Recomendação |
|---|---|
| Formato da rota da vitrine | Upgrade do `/instructors/[slug]` (zero infra nova) vs vanity `/[username]` → **recomendo `/instructors/[slug]`** |
| Alcance do branding | Só vitrine (seguro) vs também re-tematizar `/learn` → **recomendo só vitrine no v1** |
| Domínio próprio | **OUT** (diferenciador; exige DNS/cert + roteamento multi-tenant) |
| Abstração de Offer (multi-oferta/bundles) | **Adiar** |
| Co-instrutores / times | **Fora do v1** (não existe modelo de time hoje) |

## 11. Fora de escopo (v1)

Domínio próprio · escola multi-tenant (`School` collection) · white-label total · app nativo branded · gamificação/comunidade school-wide · Offer abstraction · co-instrutores. Todos são **diferenciais** das plataformas premium, não table-stakes — entram em milestone futuro se provarem valor.

---

*Plano em modo estudo. Para formalizar como GSD (`.planning/`) e executar, é preciso destravar o Bash (Fase 0) e o "go" do dono.*
