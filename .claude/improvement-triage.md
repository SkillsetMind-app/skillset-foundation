# Improvement findings triage (wf_449481dd-511)

NOTE: most "refuted" items are UNVERIFIED (verifier agents hit session limit) — treat as evidence-backed candidates.


## fe-performance

O frontend tem uma divisão saudável nas páginas de marketing (home/curso estático são RSC com next/image e fontes via next/font), mas toda a aplicação autenticada é 100% client-side sobre Firestore: 128 arquivos "use client", 60 chamadas onSnapshot em 21 arquivos de src/lib/data e zero uso de dynamic(). Os maiores custos reais encontrados são estruturais no data-fetching: listeners duplicados entre componentes pai/filho nos dashboards, listeners por item no feed da comunidade (1+2N), coleções inteiras sem limit streamadas para qualquer visitante, e download integral de vídeos de aula via getBlob antes do playback. Há também ganhos rápidos de caminho crítico: write+read seriais do Firestore bloqueando a resolução de auth em todo page load, posthog-js no bundle inicial de todas as páginas e imagens LCP sem priority.

### refuted (8)

- **[P0] Vídeos e materiais de aula baixados integralmente via getBlob antes de exibir (sem streaming)**
  - evidence: "src/lib/data/course-assets.ts:156-160 — getProtectedCourseAssetObjectUrl usa `await getBlob(ref(...))` + URL.createObjectURL; src/components/learn/enrolled-course-workspace.tsx:1183 — <ProtectedAssetPreview asset={asset} /> renderizado eagerly para cada asset da aula; :1271-1296 — useEffect chama getProtectedCourseAssetObjectUrl no mount; :1314-1321 — WatermarkedVideoPlayer recebe o blob URL como src (src/components/learn/watermarked-video-player.tsx:38-44 usa <video src> nativo, que suportaria range requests)."
  - effort: "moderate"

- **[P1] Listeners Firestore triplicados no Teacher Studio e duplicados no Learn dashboard**
  - evidence: "src/components/teacher/teacher-studio-dashboard.tsx:55 (subscribeToTeacherCourses), :73 (payoutLedger), :85 (subscribeToTeacherOrders) + os filhos montados em :174-175: src/components/teacher/teacher-overview-metrics.tsx:51 e :78 e src/components/teacher/teacher-studio-insights.tsx:67 e :79 repetem as MESMAS queries. src/components/learn/learn-dashboard.tsx:43 (subscribeToUserEnrollments) + filho em :196: src/components/learn/learner-overview-metrics.tsx:31 repete a query."
  - effort: "moderate"

- **[P1] Feed da comunidade monta 2 listeners realtime por post (comments + likes), com query de posts sem limit**
  - evidence: "src/components/learn/course-community-feed.tsx:525-542 — useEffect com subscribeToCommunityComments(post.id, ...) dentro do componente de card de post; :544-550 — segundo useEffect com subscribeToPostLikes(post.id, ...); src/lib/data/community-posts.ts:67-91 — subscribeToCommunityPosts é query(where courseSlug ==) sem limit; src/lib/data/gamification.ts:60-75 — subscribeToPostLikes escuta a subcoleção likes inteira por post."
  - effort: "involved"

- **[P1] subscribeToMemberStatsMap streama a coleção memberStats INTEIRA para cada viewer de comunidade**
  - evidence: "src/lib/data/gamification.ts:83-115 — onSnapshot(collection(db, 'memberStats')) sem where/limit; montado em src/components/learn/course-community-feed.tsx:109 para qualquer usuário autenticado com o feed aberto (deps [user])."
  - effort: "moderate"

- **[P1] Resolução de auth bloqueada por write+read seriais do Firestore em todo page load**
  - evidence: "src/lib/auth/firebase-auth.ts:53-70 — onAuthStateChanged faz `await upsertUserProfile(...)` e `await getUserProfile(...)` antes do callback({status:'authenticated'}); o upsert já é feito nos fluxos de login: signInWithEmail (:152), signUpWithEmail (:188), signInWithGoogle (:217). Consumido em src/components/auth/auth-provider.tsx:43-45."
  - effort: "moderate"

- **[P1] LegalAcceptanceGate refaz getUserProfile a cada navegação client-side**
  - evidence: "src/components/auth/auth-provider.tsx:113-154 — useEffect com deps [pathname, status, user] chama `await getUserProfile(user.uid)` em toda mudança de pathname (a checagem de rotas isentas em :122-132 só decide se mostra o modal, mas o fetch roda nas demais rotas sempre)."
  - effort: "trivial"

- **[P1] Página de venda de cursos reais (Firestore) é 100% client-side com listener realtime para conteúdo estático**
  - evidence: "src/app/courses/[slug]/page.tsx:35-43 — comentário e fallback de metadata ('resolve client-side... without the Admin SDK'); :54-73 — branch !course renderiza <CreatorCourseDetail> client-only dentro de Suspense; src/components/courses/creator-course-detail.tsx:41-57 — subscribeToViewableTeacherCourse (onSnapshot de doc) e estados de loading; src/lib/data/published-courses.ts:59-79."
  - effort: "involved"

- **[P1] Catálogo público: onSnapshot sem limit baixa TODOS os docs de curso completos (incluindo contentText das aulas)**
  - evidence: "src/lib/data/published-courses.ts:29-47 — query(collection 'courses', where status in ['published','in_review']) sem limit/orderBy/select, via onSnapshot; o tipo TeacherCourse carrega modules[].lessons[].contentText (mapeados em published-courses.ts:169-188); consumidores: src/components/courses/course-marketplace.tsx:106, src/components/learn/learner-wishlist.tsx:53, src/components/admin/admin-enrollment-panel.tsx:44 — todos só usam campos de card via teacherCourseToCourseCard (:81-126)."
  - effort: "involved"

### rest (4)

- **[P2] posthog-js no bundle inicial de todas as páginas + builder de 2.7k linhas sem code-split**
  - evidence: "src/lib/posthog/client.ts:1 — `import posthog from \"posthog-js\"` estático; src/app/posthog-provider.tsx:8-10 — initPostHog() no useEffect do provider global; src/app/layout.tsx:42 — <PostHogProvider> envolvendo o app inteiro; src/components/teacher/teacher-builder-hub.tsx:5-17 — imports eager de CourseBuilderStudio e TeacherCourseStudio com render condicional por searchParam; wc -l: course-builder-studio.tsx = 2694 linhas."
  - effort: "moderate"

- **[P2] Imagens LCP sem priority no course detail e <img> cru na capa do workspace**
  - evidence: "src/app/courses/[slug]/page.tsx:98-106 — <Image fill sizes ...> do hero SEM priority; src/components/learn/enrolled-course-workspace.tsx:434-436 — `<img src={course.image} alt={course.title} />` com eslint-disable do @next/next/no-img-element, sem dimensões; Grep 'priority' em src/ → apenas logo-wordmark.tsx:43,53,61 e platform-shell.tsx:157."
  - effort: "trivial"

- **[P2] teacherCourseToLearningCourse() inline no JSX: re-render total do workspace, LESSON_STARTED duplicado e churn de listener no preview**
  - evidence: "src/components/learn/creator-course-workspace.tsx:169 e src/components/teacher/course-preview-shell.tsx:83 — `course={teacherCourseToLearningCourse(course)}` inline no JSX; src/components/learn/enrolled-course-workspace.tsx:181-192 — useEffect de track.lessonStarted com deps [selectedLessonId, course.id, course.modules, previewMode]; :88-101 — previewEnrollment criado no corpo do componente; :152-175 — effect de subscribeToCourseAssets com workspaceEnrollment (identidade instável em preview) nas deps."
  - effort: "trivial"

- **[P3] Flash de tema claro para usuários dark-mode (data-theme só aplicado pós-hidratação)**
  - evidence: "src/lib/theme/theme-provider.tsx:68-74 — `document.documentElement.dataset.theme = resolvedTheme` dentro de useEffect (pós-hidratação); :35-45 — leitura de localStorage 'skillset_theme' apenas no cliente; src/app/layout.tsx:35-48 — nenhum script inline de tema no <html>; ThemeProvider montado só em src/components/platform/platform-shell.tsx:49."
  - effort: "trivial"

## fe-ux-polish

A base de UX é mais madura do que o típico para este estágio: assinaturas Firestore em tempo real com callbacks de erro dedicados, autosave com guarda de beforeunload no course builder, mensagens de erro quase sempre amigáveis e copy 100% em inglês consistente. Porém há três rachaduras estruturais: (1) o momento mais crítico do funil — o retorno do Stripe Checkout — joga o comprador pagante numa tela "Enrollment required" durante o gap do webhook, sem reconhecer o parâmetro checkout=success; (2) os dashboards financeiros do professor computam totais sobre subconjuntos arbitrários do Firestore (limit sem orderBy), o que torna os números silenciosamente errados a partir da 21ª venda; (3) o sistema de feedback é artesanal e fragmentado — três padrões de loading concorrentes, EmptyState compartilhado usado em 1 de ~15 lugares, zero toasts, aria-live só nas telas de auth/billing, e controles mortos (filtros do /ops, sino de notificações) que erodem confiança.

### refuted (6)

- **[P0] Pós-checkout: comprador que acabou de pagar vê 'Enrollment required' durante o gap do webhook**
  - evidence: "functions/src/index.ts:2048 e 2207 — success_url: `${appUrl}/learn/courses/${courseId}?checkout=success`. src/components/learn/creator-course-workspace.tsx:140-147 — quando enrollment é null (webhook ainda não criou), renderiza 'Enrollment required. This private workspace opens only after payment, admin enrollment, or approved access.' O componente importa useSearchParams (linha 4) mas só lê courseId (linha 22); grep por 'checkout' em src/components/learn retorna zero matches — o parâmetro checkout=success é ignorado. Mesmo padrão em enrolled-course-workspace.tsx:223-246 para cursos do catálo
  - effort: "moderate"

- **[P1] Dashboards financeiros do professor computam totais sobre subconjunto arbitrário (limit sem orderBy)**
  - evidence: "src/lib/data/orders.ts:99-103 — subscribeToTeacherOrders: where('teacherId'==) + limit(20), sem orderBy (o comentário em 69-73 admite 'NO orderBy... callers sort client-side', mas sort no cliente não corrige truncamento por docID no servidor). orders.ts:74-78 — subscribeToUserOrders limit(50) idem. src/lib/data/payout-ledger.ts:22-26 — limit(50) sem orderBy. Consumidores: teacher-wallet-panel.tsx:191-213 (reduces de grossPaidMinor/platformFeeMinor/inReleaseMinor sobre os arrays truncados), sale-list.tsx:122-123 (rotula '(most recent 20)' — falso), teacher-studio-insights.tsx:103-108 (revenue 
  - effort: "involved"

- **[P1] Filtros Period/Status do dashboard /ops são controles mortos**
  - evidence: "src/components/admin/ops-dashboard.tsx:31-46 define periodOptions/statusOptions, :54-60 monta filters, :62-69 updateParam só faz router.replace. Grep por useSearchParams em src/components/admin → único hit é o próprio ops-dashboard.tsx:50. ops-overview-metrics.tsx: zero ocorrências de 'period'. course-review-queue.tsx: nenhuma leitura de searchParams (único 'status' na linha 94 é o status do course). Nenhum dos 9 painéis recebe period/status como prop."
  - effort: "moderate"

- **[P1] Excluir módulo/aula no course builder não pede confirmação e o autosave torna a perda permanente em 1.8s**
  - evidence: "src/components/teacher/course-builder-studio.tsx:1013-1035 deleteModule e :1084-1112 deleteLesson — nenhum confirm; botões em :2046-2050 ('Delete' do módulo) e :2237-2241 ('Delete lesson') chamam direto. Autosave agendado em :1268-1270 (window.setTimeout 1800ms → runAutosave persiste via updateTeacherCourseBuilder). Contraste: course-asset-uploader.tsx:145 e lesson-content-modal.tsx:209-211 usam window.confirm para deletar um asset; teacher-event-studio.tsx:186,207 idem para eventos."
  - effort: "trivial"

- **[P1] Login não preserva destino (sem returnTo): deep links morrem no dashboard**
  - evidence: "src/components/auth/protected-surface.tsx:33-34 — CTA 'Sign in' aponta para '/login' sem nenhum parâmetro de retorno. src/components/auth/login-form.tsx:43-47 — pós-login sempre router.push(getLoadingRoute(...)). src/lib/auth/routing.ts:47-58 (getLoadingRoute) e :60-81 (getPostAuthRoute) — nenhum suporte a returnTo/next de destino; o roteamento é exclusivamente por role (ops/teach/learn)."
  - effort: "moderate"

- **[P1] Três padrões de loading concorrentes, EmptyState compartilhado usado 1x e zero sistema de toast**
  - evidence: "Skeleton: grep animate-pulse → 8 arquivos (teacher-studio-dashboard.tsx:135, course-marketplace.tsx:246-259, teacher-overview-metrics, learner-overview-metrics, ops-overview-metrics, app/courses, app/account, app/auth). Texto cru: learn-dashboard.tsx:56-64 ('Loading your learning workspace...'), sale-list.tsx:74-82, enrolled-course-workspace.tsx:194-200, learn-credentials-hub.tsx:88-94, ops-dashboard.tsx:166-169, teacher-wallet-panel.tsx:429-432, course-builder-studio.tsx:1339-1345. SkillsetSpinner: usado em só 3 superfícies (grep: protected-surface, onboarding, welcome). EmptyState compartil
  - effort: "involved"

### rest (6)

- **[P2] Mensagens de erro/sucesso sem aria-live fora de auth/billing — feedback invisível para leitores de tela**
  - evidence: "Grep aria-live|role=\"alert\"|role=\"status\" em src → apenas 8 arquivos, todos auth/billing/connect: login-form.tsx:110-111, signup-form.tsx:247-248, reset-password-form.tsx:46-56, plans-panel.tsx:175, billing-tabs.tsx:309, embedded-checkout-panel.tsx:185, teacher-connect-onboarding.tsx:318, app/auth/page.tsx:28. Sem qualquer atributo: course-builder-studio.tsx:2416-2425 (error/success do submit), profile-settings-panel.tsx:536-546, course-community-feed.tsx:250-254, teacher-wallet-panel.tsx:244-253, support-ticket-center, todos os painéis admin."
  - effort: "moderate"

- **[P2] Copy técnico vazando para o comprador no fluxo de compra ('webhook', 'feature-flagged', 'Firebase Functions')**
  - evidence: "src/components/courses/creator-course-detail.tsx:400 — 'Payment received. Your course access opens after Stripe confirms the webhook.'; :445-448 — 'Checkout is feature-flagged off until Firebase Functions and Stripe webhooks are deployed.'; :456 — 'Paid access opens only after the Stripe webhook confirms payment and creates your enrollment.'; creator-course-workspace.tsx:121-123 — 'Firebase configuration is required before enrolled creator courses can load.'"
  - effort: "trivial"

- **[P2] Checklist 'Review readiness' do rodapé do builder está dessincronizado do predicado real do botão Submit**
  - evidence: "src/components/teacher/course-builder-studio.tsx:2409-2415 — painel do rodapé hardcoda 5 itens (title, summary, modules, lessons, pricing). O disabled do submit em :2438-2449 exige adicionalmente !freePreviewLessonId (2445) e installmentsAreValid (2448). A fonte canônica readinessItems (:657-699) tem 7 itens, incluindo 'Choose one lesson as the free preview.' (:678-682) — mas o rodapé não a usa; só a aba Review (:2268) e o stepper (:1414) usam."
  - effort: "trivial"

- **[P2] Sino de notificações é permanentemente vazio (unreadCount hardcoded em 0)**
  - evidence: "src/components/platform/notification-bell.tsx:10 — `const unreadCount = 0;` (nunca atualizado); :71-84 painel estático 'You're all caught up'; :86-91 'View all' → /account?tab=notifications, que é a aba de preferências de notificação (account-settings-hub.tsx:125), não um inbox. Não existe nenhuma coleção/subscription de notificações em src/lib/data (26 arquivos listados, nenhum notifications.ts)."
  - effort: "involved"

- **[P3] lesson-content-modal fecha com clique no overlay mesmo com upload de vídeo em andamento**
  - evidence: "src/components/teacher/lesson-content-modal.tsx:232 — `<div className=\"lesson-modal-overlay\" role=\"presentation\" onMouseDown={onClose}>` sem nenhuma guarda; estado isUploading existe e gerencia o submit (:180-201) mas não protege o close; o botão X (:249) idem."
  - effort: "trivial"

- **[P3] Like na comunidade falha em silêncio absoluto (catch vazio sem feedback)**
  - evidence: "src/components/learn/course-community-feed.tsx:596-608 — handleToggleLike: `catch { // The like listener stays authoritative; a failed toggle is a no-op. }`. Todos os demais handlers do mesmo arquivo setam erro (ex.: :180 'We could not publish your post.')."
  - effort: "trivial"

## fe-architecture

O frontend tem uma fundação de camadas saudável (components → src/lib/data → src/domain, zero `any`/`as any` em produção, domínio puro com 21 arquivos de teste), mas a disciplina decai na borda dos componentes: páginas-monólito de até 2.694 linhas com lógica de negócio embutida, o mesmo trio subscribe+loading+error reescrito à mão em ~30 componentes sem um hook compartilhado, e formatação de dinheiro/data/Timestamp duplicada em 15+ lugares com locales inconsistentes. Os riscos mais caros são semânticos: dashboards do professor reimplementam a matemática de comissão em vez de usar `computePaymentSplit` (e omitem a taxa Stripe que o professor absorve, superestimando o "net"), e o tipo do ledger de payout existe em duas versões divergentes entre `src/domain` e `functions/src`. No design system, tokens existem mas são contornados por 65 literais rgba que quebram a adaptação ao dark mode.

### confirmedHigh (4)

- **[P1] Quebrar course-builder-studio.tsx (2.694 linhas) e mover helpers puros para src/domain**
  - evidence: "src/components/teacher/course-builder-studio.tsx:518 (único export do arquivo), :522-566 (bloco de 36+ useState), :318-516 (helpers puros não exportados: parsePriceAmountMinor:326, parseInstallmentsMax:346, normalizeDurationMinutes:362, getCourseStructureError:411, buildBuilderDraftPayload:448, builderDraftSignatureFromCourse:488), :700-780 (derivações recomputadas a cada render sem memo), grep useMemo|useCallback = 7 ocorrências em 2694 linhas. src/domain/teacher-course.test.tsx existe e já testa funções vizinhas."
  - effort: "involved"
  - verdict: {"isAccurate": true, "note": "Evidência confere quase integralmente no código real. Confirmado: arquivo tem exatamente 2.694 linhas e é o maior do frontend (2x o segundo, enrolled-course-workspace.tsx:1380); único export é CourseBuilderStudio em course-builder-studio.tsx:518; todos os 8 helpers puros existem não-exportados nas linhas citadas (parsePriceAmountMinor:326, parseInstallmentsMax:346, normalizeDurationMinutes:362, normalizeDripDelayDays:372, sanitizeModules:407, getCourseStructureError:411, buildBuilderDraftPayload:448, builderDraftSignatureFromCourse:488) e grep em src/ prova que NÃ

- **[P1] Criar hook useFirestoreSubscription e unificar a política de erro das subscriptions**
  - evidence: "Padrão repetido: 30 componentes chamam subscribeTo* (grep), 29 contêm setIsLoading(false). Exemplos: src/components/learn/learn-dashboard.tsx:24-54 (enrollments+isLoading+error+useEffect), src/components/learn/enrolled-course-workspace.tsx:104-175 (3 effects de subscription com estados ad-hoc {key, lessonIds, ready} e {assets, key, ready}). Política de erro divergente: src/lib/data/subscription-error.ts:11-15 (helper existe) usado por apenas 4 componentes; src/components/admin/ops-overview-metrics.tsx:42 e :55 passam onError = () => {} (falha invisível); os demais setam strings locais ('We co
  - effort: "moderate"
  - verdict: {"isAccurate": true, "note": "Evidência confirmada no código real, quase toda exata: (1) subscription-error.ts:11-15 contém logSubscriptionError exatamente como citado, usado por só 4 componentes (teacher-studio-insights, teacher-studio-dashboard, teacher-overview-metrics, learner-overview-metrics); (2) ops-overview-metrics.tsx:42 e :55 passam onError = () => {} exatamente nessas linhas — o try/catch ao redor só cobre falha síncrona de init, erros de runtime do stream são engolidos e o painel admin mostra 0 tickets/reports sem sinal de falha; (3) learn-dashboard.tsx:24-54 confere (enrollments 

- **[P1] Dashboards do professor reimplementam a matemática de comissão e divergem do split real (net superestimado)**
  - evidence: "src/domain/payment-split.ts:4-8 ('the teacher absorbs the Stripe processing fee') e :62-82 (computePaymentSplit subtrai platformCommission + stripeFee); src/components/teacher/teacher-studio-dashboard.tsx:38-48 (comentário 'Mirror of…/Kept local' + netMinor = max(0, gross - platformFee), sem stripeFee); src/components/teacher/teacher-wallet-panel.tsx:191-201 (teacherNetMinor = grossPaidMinor - platformFeeMinor, mesma fórmula inline Math.floor((amountMinor * platformFeeBps) / 10000)) vs :202-207 (inReleaseMinor/releasedMinor somam entry.netAmountMinor do ledger, que JÁ desconta stripeFee)."
  - effort: "moderate"
  - verdict: {"isAccurate": true, "note": "Evidência confere no código real. (1) src/domain/payment-split.ts:4-8 documenta que o professor absorve a taxa Stripe (D1/D2) e computePaymentSplit:62-82 subtrai comissão + stripeFee. (2) teacher-studio-dashboard.tsx:38-48 tem o comentário literal 'Mirror of the net-payout computation… Kept local' e netMinor = max(0, gross - platformFee) SEM stripeFee; o chip exibe 'Next payout' (linhas 149-153), superestimando o payout real. (3) teacher-wallet-panel.tsx:191-201 repete a fórmula inline (gross - platformFee) enquanto :202-207 soma entry.netAmountMinor do ledger, qu

- **[P1] Drift de tipos do PayoutLedger entre src/domain e functions/src**
  - evidence: "src/domain/payout-ledger.ts:1-29 (PayoutLedgerStatus union de 6 valores; PayoutLedgerEntry sem kind/invoiceId/plannedTransferAmountMinor) vs functions/src/index.ts:187-240 (PayoutLedgerRecord com status: string e os campos extras documentados, ex. paymentIdIsPaymentIntent com doc-comment de 15 linhas). src/domain/payment-split.ts:12-14: 'This module is the SOURCE OF TRUTH. functions/src/index.ts mirrors… and must be kept in sync with this.' Consumo frontend: src/components/teacher/teacher-wallet-panel.tsx:203-213 filtra por strings de status que compilam contra a union de src mas não contra o
  - effort: "moderate"
  - verdict: {"isAccurate": true, "note": "Evidência confere integralmente. (1) src/domain/payout-ledger.ts:1-29: union de 6 status e PayoutLedgerEntry sem os 8 campos do backend — confirmado. (2) functions/src/index.ts:184-234 (proposta citou 187-240, offset trivial): PayoutLedgerRecord com status: string (linha 214) e todos os 8 campos extras confirmados (kind:192, invoiceId:194, subscriptionId:196, paymentIdIsPaymentIntent:208, releaseAttemptCount:216, transferReversedAmountMinor:218, transferAmountMinor:227, plannedTransferAmountMinor:233); drift adicional não citado: currency é SkillsetCurrency no bac

### refuted (1)

- **[P1] Substituir 65 literais rgba(178,34,52,…) pelo token --color-danger-soft (dark mode quebrado nessas superfícies)**
  - evidence: "src/app/globals.css:42 (--color-danger-soft: rgba(178,34,52,0.06)) e :80 (override dark: 0.18, com justificativa WCAG nas linhas 81-86); grep 'rgba(178,34,52' = 88 ocorrências em src (65 delas no padrão 0.06 de fundo de erro, ex. src/components/learn/learn-dashboard.tsx:70 bg-[rgba(178,34,52,0.06)]); globals.css:306 ([data-theme=\"dark\"] .bg-white) com comentário nas linhas 9-12 do bloco: 'override can't reach on hover:/focus: compound selectors'; padrão de card 'rounded-[4px] border border-[var(--color-line)] bg-white' repetido 70x e 'shadow-[var(--shadow-soft)]' 140x."
  - effort: "moderate"

### rest (5)

- **[P2] Centralizar formatação de dinheiro/data e conversão de Timestamp em src/lib/format**
  - evidence: "Duplicatas literais: src/components/teacher/sale-list.tsx:12-32, src/components/teacher/sale-detail.tsx:16-40, src/components/teacher/teacher-wallet-panel.tsx:542-560, src/components/account/billing-tabs.tsx:20-41; mais formatadores em src/components/admin/payment-operations-panel.tsx:10, src/components/admin/course-review-queue.tsx:38, src/data/platform.ts:6-20 (formatUsd/formatUsdWhole), src/lib/data/published-courses.ts:84 e :131. Locales mistos: 'en' (sale-list) vs 'en-US' (teacher-studio-dashboard.tsx:20). Duck-typing de Timestamp em 5 arquivos (grep 'toDate?: () => Date'); 45 campos '?:
  - effort: "moderate"

- **[P2] Extrair primitivo <Modal> compartilhado (4 implementações divergentes de overlay)**
  - evidence: "src/components/account/upgrade-modal.tsx:26-45 (Escape + body.style.overflow manuais) e :52-63 (backdrop próprio); src/components/teacher/lesson-content-modal.tsx:232 (<div className=\"lesson-modal-overlay\" role=\"presentation\" onMouseDown={onClose}> — abordagem CSS-class distinta, 87 menções a lesson-modal em src/app/globals.css); src/components/teacher/course-builder-studio.tsx:121-152 (CategoryMultiSelect com mousedown/keydown handlers próprios); grep 'fixed inset-0' também em src/components/platform/mobile-sidebar-drawer.tsx e src/components/site/site-nav.tsx."
  - effort: "moderate"

- **[P2] Validar leituras do Firestore com converters em vez de 32 casts `as Omit<T,"id">`**
  - evidence: "grep 'as Omit<' em src/lib/data = 32 ocorrências (ex.: src/lib/data/teacher-courses.ts:155 e :178, src/lib/data/published-courses.ts:41 e :74, src/lib/data/enrollments.ts:99/124/158, src/lib/data/orders.ts:33). Consumo sem guard: src/lib/data/published-courses.ts:169 (course.modules.map(...) direto do cast)."
  - effort: "involved"

- **[P3] Adotar EmptyState/SkillsetSpinner existentes no lugar de 40 empty-states e 16 loadings ad-hoc**
  - evidence: "src/components/shared/empty-state.tsx:13-38 (componente pronto com eyebrow/title/cta); grep: EmptyState usado em 2 arquivos vs 40 ocorrências de strings ad-hoc 'No … match this search/No … yet' em src/components; 16 ocorrências de <p>Loading… (ex. src/components/learn/learn-dashboard.tsx:60, src/components/learn/enrolled-course-workspace.tsx:197) vs SkillsetSpinner em 2 arquivos."
  - effort: "trivial"

- **[P2] Decompor course-community-feed.tsx e enrolled-course-workspace.tsx em arquivos por subcomponente**
  - evidence: "src/components/learn/course-community-feed.tsx: 1.073 linhas com CommunityInfoPanel:325, CommunityMembersPanel:366, CommunityPostCard:496, CommentNode:802, CommentBody:919, ReportControl:959 — todos privados no arquivo; 25 useState no total. src/components/learn/enrolled-course-workspace.tsx: 1.380 linhas, 16 useState, 4 efeitos de subscription (linhas 104-192) + formatação de drip inline (linha 749: 'Unlocks ' + Intl.DateTimeFormat)."
  - effort: "moderate"

## fe-a11y-deep

A base de acessibilidade do Skillset é acima da média para um produto jovem: tokens de contraste foram auditados matematicamente (comentários WCAG em globals.css:23-27 e 81-87), há tratamento global de prefers-reduced-motion (globals.css:4211-4239), labels implícitas envolvem quase todos os inputs, e componentes como o feed da comunidade (aria-pressed/aria-label nos likes) e o toggle de configurações (role=switch + aria-checked) seguem boas práticas. Os problemas reais estão uma camada acima: ARIA "decorativa" sem o modelo de teclado correspondente (tablists e radiogroups sem arrow keys nem roving tabindex, zero ocorrências de role=tabpanel no app), estados assíncronos críticos que mudam em silêncio para leitores de tela (autosave "Save failed" do course builder, progresso de upload, resultados de busca), ausência total de skip-link com o <main> envolvendo a própria sidebar, e — o mais grave para um marketplace de cursos nos EUA — o player de vídeo não suporta legendas, embora exista uma preferência "Auto-show captions" no settings que não é consumida por nada.

### refuted (4)

- **[P1] Player de vídeo sem suporte a legendas — e a preferência 'Auto-show captions' é um setting morto**
  - evidence: "src/components/learn/watermarked-video-player.tsx:38-44 — `<video aria-label={fileName} controls controlsList=\"nodownload\" src={src} />` sem nenhum elemento <track>; src/components/account/account-settings-hub.tsx:332-336 — toggle 'Auto-show captions' grava prefs.autoCaptions; src/domain/user-profile.ts:35,52 — campo definido com default true; grep por autoCaptions retorna apenas esses 4 pontos: nenhum player consome a preferência."
  - effort: "involved"

- **[P1] Sem skip-link e <main> engloba a sidebar inteira — teclado atravessa 15+ itens de navegação em toda página**
  - evidence: "src/app/layout.tsx:35-48 — RootLayout renderiza body sem nenhum skip-link (grep por 'skip' em src = 0 matches); src/components/platform/platform-shell.tsx:50-126 — `<main className=\"page-shell platform-shell-root\">` abre na linha 50 e contém a `<aside className=\"platform-sidebar...\">` (linha 59-72) e o PlatformHeader antes da `<section className=\"platform-content\">` (linha 76)."
  - effort: "trivial"

- **[P1] Tablists e radiogroups com roles ARIA mas sem o modelo de teclado — zero role='tabpanel' no app inteiro**
  - evidence: "src/components/shared/horizontal-tabs.tsx:33-51 — role=\"tablist\"/role=\"tab\"/aria-selected sem onKeyDown, sem tabIndex roving, sem aria-controls; grep por 'tabpanel' em src = 0 matches; src/components/auth/auth-page.tsx:46-58 — mesmo padrão; src/components/learn/course-review-panel.tsx:93-107 — radiogroup de 5 estrelas com buttons role=\"radio\" todos tabuláveis, sem Arrow keys; src/components/account/plans-panel.tsx:144-170 — radiogroup 'Billing cycle' idem. Contraste: teacher-studio-insights.tsx:129-135 usa o padrão correto (role=\"group\" + aria-pressed)."
  - effort: "moderate"

- **[P1] Falha de autosave, progresso de upload e mensagens do builder mudam em silêncio para leitores de tela**
  - evidence: "src/components/teacher/course-builder-studio.tsx:2496-2539 — BuilderSaveStatus renderiza spans ('Saving', 'Unsaved changes', 'Save failed — use Save draft' em 2526-2529, 'All changes saved') sem role=\"status\"/aria-live; course-builder-studio.tsx:2416-2425 — blocos {error}/{success} sem role; src/components/teacher/course-asset-uploader.tsx:309-340 — barra de progresso e 'Upload complete' sem role=\"status\"/aria-live e sem role=\"progressbar\"; src/components/courses/course-marketplace.tsx:234-244 — erros sem role. Padrão correto já existente: src/components/auth/login-form.tsx:110-111 (rol
  - effort: "moderate"

### rest (8)

- **[P2] Resultados de busca/filtros do marketplace atualizam sem nenhum anúncio para SR**
  - evidence: "src/components/courses/course-marketplace.tsx:180-181 — isFiltering derivado de deferredQuery; 208-216 — input de busca sem aria-live associado; 262-284 — bloco 'No matches' renderizado condicionalmente sem role/aria-live; nenhum contador de resultados anunciável existe no componente."
  - effort: "trivial"

- **[P2] Busca da sidebar: input nomeado só por placeholder e atalho 'Ctrl K' que não funciona (listener no próprio input)**
  - evidence: "src/components/platform/platform-shell.tsx:198-207 — `<label className=\"platform-sidebar-search\">` contém apenas ícone aria-hidden, input com placeholder e `<span aria-hidden>Ctrl K</span>` (nenhum texto de label); 186-195 — handleKeyDown com o branch `(event.metaKey || event.ctrlKey) && event.key === 'k'` está em onKeyDown do input (linha 204), não em document."
  - effort: "trivial"

- **[P2] Tooltip da taxa Stripe no pricing é inacessível por teclado e leitor de tela**
  - evidence: "src/app/pricing/page.tsx:174-177 — `<Tooltip content=\"Stripe's processing fee...\"><HelpCircle aria-hidden=\"true\" size={12}...` (ícone aria-hidden, sem tabIndex/button); src/components/shared/tooltip.tsx:48-58 — abre via onFocus/onMouseEnter no wrapper, e o aria-describedby só é aplicado quando open=true (um SR parado no elemento nunca dispara o open)."
  - effort: "trivial"

- **[P2] Presets de upload usam role='list'/'listitem' em <button>, apagando a semântica de botão e o estado selecionado**
  - evidence: "src/components/teacher/course-asset-uploader.tsx:194-225 — `<div className=\"course-upload-presets\" role=\"list\" aria-label=\"Upload type\">` contendo `<button type=\"button\" role=\"listitem\" onClick={...}>` (linha 200-203) com estado ativo somente via `className={...course-upload-preset--active...}` (linha 212), sem aria-pressed/aria-checked."
  - effort: "trivial"

- **[P2] Dropdowns prometem 'menu' (aria-haspopup) mas não entregam semântica nem estado selecionado**
  - evidence: "src/components/shared/dashboard-filters.tsx:89-90 — aria-haspopup=\"menu\"/aria-expanded no trigger; 103-121 — popup é <div> sem role e opções <button> sem role/aria-checked, seleção atual só via classes bg na linha 113-117; src/components/shared/export-table-button.tsx:98-125 — role=\"menu\"/\"menuitem\" presentes mas sem gestão de foco/setas; src/components/platform/notification-bell.tsx:43-57 — aria-haspopup=\"menu\" com painel não-menu."
  - effort: "moderate"

- **[P2] Dezenas de inputs do builder/admin removem o outline e sinalizam foco apenas com mudança de cor de borda de 1px**
  - evidence: "src/components/teacher/course-builder-studio.tsx:1543,1569,1617,1698,1707,1770,1791,1807,1847... e src/components/teacher/teacher-event-studio.tsx:254,274,290,303,314,327, src/components/admin/admin-enrollment-panel.tsx:144,163 etc. — todos `outline-none ... focus:border-[var(--color-primary-light)]`; padrão forte já existente: src/app/globals.css:1348-1354 (.field-input:focus com box-shadow 0 0 0 3px) e src/components/platform/platform-nav.tsx:185 (focus-visible:ring-2); globals.css:2529-2552 (.lesson-modal-field) tem o mesmo problema de outline:none com só border-color no focus."
  - effort: "moderate"

- **[P3] Hierarquia de headings salta de h1 para h3/h4 nas superfícies da plataforma**
  - evidence: "src/components/platform/platform-shell.tsx:92-102 — h1 do shell; src/components/learn/enrolled-course-workspace.tsx:229,401,480,512,559,588,773,867,881,897 — somente h3/h4/h5, nenhum h2 (grep <h[1-6] no arquivo); src/components/learn/course-review-panel.tsx:83 — h4 'Rate the learning experience'; src/components/platform/notification-bell.tsx:59 — h4 'Notifications' dentro de popup."
  - effort: "moderate"

- **[P3] Dados tabulares financeiros (ledger de payouts) renderizados como grid de divs sem associação coluna-valor**
  - evidence: "grep '<table' em src = apenas src/app/pricing/page.tsx:159 (com th scope correto em 162-184); src/components/teacher/teacher-wallet-panel.tsx:515-532 — LedgerRow é `<div className=\"grid ... md:grid-cols-[140px_1fr_150px_120px_auto]\">` renderizado em lista (linhas 440-441) sem thead/role=columnheader; mesmo padrão nas demais listas de dashboard (sales, refunds)."
  - effort: "moderate"

## fe-product-learner-teacher

O loop central do marketplace está bem construído: busca/filtros/ordenação com curadoria e trending no catálogo, wishlist, retomar de onde parou com progresso server-side, certificados verificáveis, comunidade com leaderboard e eventos ao vivo via links externos. Porém a plataforma é "muda e cega" em três eixos: (1) não existe NENHUM canal de notificação — sem e-mails transacionais, sino de notificações hardcoded vazio e preferências salvas sem canal que as consuma, enquanto a UI promete "you'll be notified"; (2) dados já coletados não fecham o loop — reviews são submetidas mas nunca exibidas na página de venda, e o progresso por aula é gravado mas o KPI de Completion do professor mostra "--" e não há analytics de drop-off; (3) o catálogo real (cursos Firestore) é invisível para crawlers — metadata genérica, fora do sitemap e renderizado client-side, enquanto apenas cursos-amostra estáticos são indexáveis. Cupons, equipe, integrações e coproduções são painéis "Planned" honestos, sendo cupons o de maior valor destravável.

### confirmedHigh (6)

- **[P0] Exibir reviews de alunos na página pública do curso (data layer já existe, zero consumidores)**
  - evidence: "src/lib/data/course-reviews.ts:46-73 exporta subscribeToCourseReviews (reviews status==published, max 12) — grep no projeto mostra ZERO consumidores (única ocorrência é a própria definição). src/components/courses/creator-course-detail.tsx:161-164 mostra apenas o agregado ratingLabel ('4.5 / 5 from N reviews') no <dl> lateral (linha 368). A submissão existe e funciona: src/components/learn/course-review-panel.tsx:53-75 chama submitCourseReview; backend em functions/src/index.ts:2322."
  - effort: "moderate"
  - verdict: {"isAccurate": true, "note": "Evidência confere integralmente. (1) subscribeToCourseReviews existe em src/lib/data/course-reviews.ts:46-73 (where status=='published', limit 12, sort client-side) e grep no projeto retorna só a definição — zero consumidores. (2) creator-course-detail.tsx:161-164 monta apenas o agregado ratingLabel, exibido na linha 368 no <dl> lateral; nenhum texto de review é renderizado em lugar algum (grep por reviews.map/review.body só acha o painel de submissão do próprio aluno). (3) Backend confirmado: functions/src/index.ts:2322 (submitCourseReview onCall), gate de 50% de

- **[P0] Construir a camada de notificações: sino vazio hardcoded, preferências sem canal e promessa 'you'll be notified' não cumprida**
  - evidence: "src/components/platform/notification-bell.tsx:10 — `const unreadCount = 0` hardcoded; linhas 71-84 sempre renderizam 'You're all caught up' (shell sem fonte de dados). src/components/account/account-settings-hub.tsx:226-227 — copy admite 'applied as each channel ships' com 4 toggles persistidos em preferences.notifications que nada consome. Grep por sendgrid|nodemailer|resend|mailgun|postmark em functions/src: zero providers; nenhuma das 31 funções exportadas (functions/src/index.ts:991-5411) envia e-mail. Promessa quebrada: src/components/courses/creator-course-detail.tsx:539-541 — 'Skillset
  - effort: "involved"
  - verdict: {"isAccurate": true, "note": "Evidência confere integralmente no código real: notification-bell.tsx:10 tem `const unreadCount = 0` hardcoded e linhas 71-84 sempre renderizam o empty state sem fonte de dados; account-settings-hub.tsx:226-227 contém a copy 'applied as each channel ships' com 4 toggles persistidos via updateUserPreferences (linha 209) que nada em functions/src consome (grep 'notifications' = zero matches); zero providers de e-mail em functions/src (matches de 'resend' são docs e o botão 'Resend verification' do Firebase Auth em status-banner.tsx:80); promessa 'you'll be notified'

- **[P1] SEO: cursos reais do marketplace são invisíveis para crawlers (metadata genérica, fora do sitemap, render client-side)**
  - evidence: "src/app/courses/[slug]/page.tsx:35-43 — fallback explícito: 'Creator (Firestore) courses resolve client-side... Give a clean course-scoped fallback' com title fixo 'Course'. src/app/sitemap.ts:42-49 — comentário admite: 'Creator (Firestore) courses resolve client-side and can't be enumerated in this force-static sitemap'; só getCourseSlugs() (amostras estáticas) entram. src/components/courses/creator-course-detail.tsx:1 'use client' + :46 subscribeToViewableTeacherCourse via onSnapshot. JSON-LD existe só para amostras: src/app/courses/[slug]/page.tsx:93 buildCourseJsonLd com purchasable=false
  - effort: "involved"
  - verdict: {"isAccurate": true, "note": "CONFIRMADO em todos os pontos. (1) Evidência exata: src/app/courses/[slug]/page.tsx:35-43 tem o fallback com title fixo 'Course' e o comentário citado; src/app/sitemap.ts:6 é force-static e :42-49 admite que cursos Firestore não são enumerados (só getCourseSlugs() de demoCourses estáticos — catalog.ts:50-52 importa de @/data/demo/courses); creator-course-detail.tsx:1 'use client' + :46 subscribeToViewableTeacherCourse via onSnapshot (published-courses.ts:64); JSON-LD só para amostras com purchasable=false (page.tsx:86,93; course-jsonld.ts:23-24 exclui creator cour

- **[P1] Analytics do professor ignora dados de progresso já coletados: Completion '--' e zero visão de drop-off por aula**
  - evidence: "src/components/teacher/teacher-overview-metrics.tsx:160-167 — card Completion com value '--' e hint 'Unlocks after learners finish lessons' (comentário: 'Completion is not measured yet'). Dados existem: functions/src/index.ts:3415-3445 — recordLessonProgress mantém subcoleção enrollments/{id}/progress por lessonId e atualiza enrollment.progressPercent/status em transação. src/components/teacher/teacher-studio-insights.tsx:62-114 — consome apenas subscribeToTeacherCourses + subscribeToTeacherOrders; nenhuma leitura de progresso."
  - effort: "involved"
  - verdict: {"isAccurate": true, "note": "Evidência confere integralmente. (1) teacher-overview-metrics.tsx:160-167: card Completion hardcoded com value '--', hint 'Unlocks after learners finish lessons' e comentário 'Completion is not measured yet' — exato. (2) functions/src/index.ts:3387-3461 (recordLessonProgress): mantém subcoleção enrollments/{id}/progress/{lessonId} e recomputa enrollment.progressPercent/status em transação — range citado 3415-3445 está dentro do bloco. (3) teacher-studio-insights.tsx:62-114: assina apenas subscribeToTeacherCourses + subscribeToTeacherOrders (+ subscribeToUserProfil

- **[P1] Página de venda não mostra quem é o instrutor, e o perfil público do instrutor não lista os cursos dele**
  - evidence: "src/components/courses/creator-course-detail.tsx — grep por owner|instructor|educator: ownerId usado só para permissão (linha 104 isOwner); o <dl> 'At a glance' (linhas 359-376) tem Category/Status/Lessons/Price/Rating/Access, sem instrutor. src/components/instructors/instructor-profile-view.tsx:116-117 — único CTA é 'View courses on Skillset' apontando para /courses genérico. Infra existente: functions/src/index.ts:1522 syncPublicTeacherProfile projeta publicProfiles/{uid} anonimamente legível (comentário em src/app/instructors/[slug]/page.tsx:12-14)."
  - effort: "moderate"
  - verdict: {"isAccurate": true, "note": "Evidência confere integralmente. (1) creator-course-detail.tsx:104 usa ownerId só para isOwner/permissão; o dl 'At a glance' (linhas 359-390) tem apenas Category/Status/Lessons/Price/Rating/Access — nenhum nome/foto/bio de instrutor na página de venda, e grep por 'About the instructor' em src/ retorna vazio. (2) instructor-profile-view.tsx:115-118 — único CTA é 'View courses on Skillset' → /courses genérico (beco sem saída confirmado). (3) Infra pronta confirmada: syncPublicTeacherProfile existe em functions/src/index.ts:1532 (proposta citou 1522; drift de ~10 lin

- **[P1] Cupons: página 'Planned' enquanto o checkout não aceita nem promotion codes nativos do Stripe**
  - evidence: "src/app/teach/coupons/page.tsx:3-9 — renderiza TeacherComingSoonPanel (componente 'Planned' com mailto de notify, teacher-coming-soon-panel.tsx:57-66). functions/src/index.ts:2167-2209 — sessionParams do createCheckoutSession (mode payment) não contém allow_promotion_codes nem discounts; idem o fluxo subscription (2020-2058). src/lib/posthog/events.ts:67 — CheckoutStartedProps já tem coupon_code?: string."
  - effort: "moderate"
  - verdict: {"isAccurate": true, "note": "Evidência confere no código real. (1) src/app/teach/coupons/page.tsx:3,9-16 renderiza TeacherComingSoonPanel com chip 'Planned' (teacher-coming-soon-panel.tsx:44) e mailto 'Notify me' exatamente em teacher-coming-soon-panel.tsx:57-66. (2) Grep repo-wide por allow_promotion_codes|promotion_code|discounts: zero matches — não implementado em lugar nenhum. sessionParams do checkout payment-mode (functions/src/index.ts:2181-2219; citado 2167-2209, drift menor) e o create de subscription (index.ts:2034-2072; citado 2020-2058) não contêm allow_promotion_codes nem discoun

### rest (3)

- **[P2] Professor não tem visão de alunos matriculados — 'gestão de alunos' hoje é só a lista de orders**
  - evidence: "src/components/teacher/sale-list.tsx:61 — única fonte é subscribeToTeacherOrders. src/lib/data/enrollments.ts — não existe query teacher-facing: apenas subscribeToUserEnrollments (linha 82, por userId) e subscribeToAdminGrantedEnrollments (linha 108, admin). src/components/teacher/teacher-studio-insights.tsx:103 — 'New students' = paidOrders.length, ignorando matrículas free (createFreeCourseEnrollment, functions/src/index.ts:2244)."
  - effort: "involved"

- **[P3] Curadoria 'Featured' meio-ligada: sort usa featuredRank mas o admin só consegue alternar um boolean**
  - evidence: "src/lib/data/course-sort.ts:42-53 — sortFeaturedFirst ordena por featuredRank (missing rank 'sinks below any explicit rank'). src/lib/data/published-courses.ts:121-122 — card carrega featured/featuredRank do doc. src/components/admin/managed-course-panel.tsx:88-96 — handleToggleFeatured chama apenas setCourseFeatured(course.id, boolean); nenhum input de rank em todo src/components/admin."
  - effort: "trivial"

- **[P3] Funil PostHog incompleto para upgrades de plano: CHECKOUT_COMPLETED nunca emitido no fluxo de billing**
  - evidence: "src/app/account/billing/return/page.tsx:27-33 — TODO(posthog) explícito: 'emit CHECKOUT_COMPLETED here once we expose a backend endpoint... The richer server-side capture should land in functions/src/index.ts inside the customer.subscription.created webhook handler.' Contraste: vendas de curso já emitem server-side em functions/src/index.ts:4070-4078 (captureServerEvent CHECKOUT_COMPLETED com platform_fee_bps). src/components/account/embedded-checkout-panel.tsx:108 emite apenas checkoutStarted."
  - effort: "moderate"

## be-performance-cost

O backend é um único bundle (functions/src/index.ts, 5.492 linhas, ~31 funções + probe) com config global mínima (setGlobalOptions só define region e maxInstances:10 — sem memory, concurrency ou timeoutSeconds em nenhuma função) e nenhum firestore.indexes.json versionado. O caminho do dinheiro é cuidadosamente idempotente, mas as funções agendadas não escalam: dailyReleaseTransfers amostra 50 docs sem filtrar por releaseAt (começa a atrasar payouts com ~2 vendas/dia dado o hold de 30 dias) e não tem recuperação para ledgers presos em "releasing"; rebuildLeaderboards e recordLessonProgress têm read amplification que cresce linear/quadraticamente com o uso. Há ganhos triviais de latência/custo disponíveis: memoizar o cliente Stripe (hoje recriado a cada chamada, perdendo keep-alive), lazy-import do SDK Stripe (8MB pagos no cold start por ~20 funções que nunca o usam), early-filter de tipos no webhook e políticas de TTL para 4 coleções de housekeeping que crescem sem limite.

### confirmedHigh (2)

- **[P0] dailyReleaseTransfers atrasa payouts a partir de ~2 vendas/dia e abandona ledgers em "releasing" após crash/timeout**
  - evidence: "functions/src/index.ts:2890-2894 (query .where(\"status\",\"==\",\"in_release\").limit(50), sem filtro/orderBy releaseAt); :2904-2907 (skip in-memory dos não-devidos, desperdiçando o slot da amostra); :2983 (claim seta status \"releasing\"); :2926-2934 (único retorno a \"in_release\" é o catch, que não roda em timeout/crash); grep por \"releasing\" no src confirma zero queries de recuperação; :2881-2887 (onSchedule sem timeoutSeconds); :3150 (captureServerEvent com flush HTTP dentro do loop, ver posthog.ts:84)."
  - effort: "involved"
  - verdict: {"isAccurate": true, "adjustedPriority": "P0", "note": "CONFIRMADO no código real (line numbers do analista drifted ~10 linhas, substância 100% correta). (1) index.ts:2900-2904: query .where(\"status\",\"==\",\"in_release\").limit(50) SEM filtro releaseAt e SEM orderBy; skip in-memory dos não-devidos em :2914-2917 desperdiça slots. (2) payment-rules.ts:12: payoutReleaseDelayDays=30 — com pool>50, ~1,7 releases/dia esperados; throughput math procede (nuance: backlog só diverge estritamente a ≥50 vendas/dia; abaixo converge para B=30s²/(50−s), mas atraso cresce superlinearmente — +7,5 dias a 10 

- **[P1] recordLessonProgress relê a subcoleção progress inteira a cada toggle de aula — O(N) reads por clique, O(N²) por aluno que conclui o curso**
  - evidence: "functions/src/index.ts:3400 (transaction.get(progressCollectionRef) — subcoleção inteira lida dentro da transação a cada chamada); :3332 + :3378 (enrollment lido duas vezes: pré-check e re-read na txn); :3354-3357 (read do course para validar lessonIds); :3329 (rate limit 200/h = mais 1 read+write transacional por chamada via enforceRateLimit, :874-909)."
  - effort: "moderate"
  - verdict: {"isAccurate": true, "note": "CONFIRMADO no código real (linhas citadas deslocadas ~15-18 por edits não commitados, mas substância 100% correta): functions/src/index.ts:3418 faz transaction.get(progressCollectionRef) — subcoleção progress inteira lida a cada toggle (O(N) por clique, soma triangular por aluno). Enrollment lido 2x (:3350 pré-check + :3396 re-read na txn), course lido em :3372-3382, rate limit 200/h em :3347 via enforceRateLimit (:875-911, +1 read +1 write transacionais). NÃO implementado em lugar nenhum: grep por completedLessonIds/arrayUnion/count()/AggregateField em functions/

### rest (8)

- **[P2] rebuildLeaderboards: full-scan do ledger pointsEvents 2× por execução + N+1 sequencial em memberStats**
  - evidence: "functions/src/index.ts:1739-1742 (pointsEvents .where(\"createdAt\",\">=\",cutoff).get() sem limite); :1790-1793 (buildWindowLeaderboard chamado para 30d E 7d — segunda leitura redundante da mesma janela); :1761-1763 (loop for com await db.collection(\"memberStats\").doc(uid).get() sequencial por entrada do ranking); :1660-1669 (pointsEvents é append-only, sem TTL — cresce para sempre)."
  - effort: "moderate"

- **[P2] SDK do Stripe (8MB) importado estaticamente no bundle único — ~20 funções que nunca usam Stripe pagam o import em todo cold start**
  - evidence: "functions/src/index.ts:43 (import Stripe from \"stripe\" no topo do módulo, escopo global de todas as 31 funções); :655-677 (getStripeClient é o único construtor); apenas 11 exports usam Stripe (createCheckoutSession:1907, createTeacherStripeAccountLink:2469, refreshTeacherStripeAccount:2544, requestRefund:2668, dailyReleaseTransfers:2881, issueAdminRefund:3469, stripeWebhook:3695, createBillingCheckoutSession:5033, createBillingPortalSession:5118, cancelCourseSubscription:5155, createConnectAccountSession:5411); medição: node require('stripe') = 1129ms / du = 8.0M no functions/node_modules."
  - effort: "trivial"

- **[P2] getStripeClient cria um new Stripe() por chamada — perde keep-alive HTTP e paga TLS handshake extra em cada API call**
  - evidence: "functions/src/index.ts:674-676 (return new Stripe(...) sem memoização); chamadas múltiplas no mesmo request: :3716 (constructEvent) + :3891 (paymentIntents.retrieve) no checkout.session.completed; :3716 + :4147 (subscriptions.retrieve) + :4254 (invoices.retrieve expand payments) no invoice.paid; :4722 e :4573 criam mais clientes no fluxo de refund."
  - effort: "trivial"

- **[P2] expireStalePendingOrders busca 300 pendentes em ordem arbitrária sem filtro de data — orders stale podem nunca ser varridos**
  - evidence: "functions/src/index.ts:2844-2848 (.where(\"status\",\"==\",\"pending\").limit(300).get() sem where/orderBy em createdAt); :2861-2864 (filtro de 48h feito em memória, skippedCount); :2829-2831 (comentário declarando a intenção de backstop)."
  - effort: "moderate"

- **[P2] stripeWebhook grava marker de idempotência (2 writes + 1 read) para TODO evento, inclusive tipos sem handler**
  - evidence: "functions/src/index.ts:3734-3743 (claimStripeEvent executado incondicionalmente antes de qualquer checagem de event.type); :3745-3836 (cadeia de ifs cobre 11 tipos: checkout.session.completed/async_payment_succeeded/async_payment_failed/expired, payment_intent.payment_failed, charge.refunded, customer.subscription.created/updated/deleted, invoice.payment_failed, invoice.paid); :3842-3845 (markStripeEventDone sempre executado); payment-rules.ts:446-468 (claim = ref.create + possível ref.get; done = ref.set merge)."
  - effort: "trivial"

- **[P2] Quatro coleções de housekeeping crescem sem limite — sem nenhuma política de TTL**
  - evidence: "functions/src/index.ts:3734-3736 (processedStripeEvents — markers criados por evento, nenhum caminho de deleção no codebase); :880-908 (rateLimits — set com merge, nunca expirado/limpo); :1660-1669 (pointsEvents append-only; janela máxima consumida é 30d em :1792); :2088-2104 e :4090-4101 (checkoutLocks deletados apenas via markOrderStatus/settle — um lock cujo evento terminal se perdeu fica órfão, apenas sobrescrito num takeover futuro)."
  - effort: "trivial"

- **[P2] Nenhuma função tem memory/concurrency/timeout explícitos — tudo roda no default de 256MiB com maxInstances global de 10**
  - evidence: "functions/src/index.ts:76 (setGlobalOptions({ region: \"us-central1\", maxInstances: 10 }) — únicas opções globais); grep por timeoutSeconds|memory:|concurrency em functions/src retorna apenas um comentário (:2070); :3695-3697 (stripeWebhook sem options além de secrets); :2881-2886 (dailyReleaseTransfers idem)."
  - effort: "trivial"

- **[P3] PostHog flusha sincronamente 1 evento por vez dentro do webhook e do loop de releases; config de payout relida a cada evento de checkout**
  - evidence: "functions/src/posthog.ts:45-47 (flushAt: 1, flushInterval: 0) e :84 (await client.flush() por captura); functions/src/index.ts:3150 (captureServerEvent dentro de releaseLedgerTransfer, chamado no loop :2900-2936); :4074-4083 (captura no fim do handler de checkout do webhook); :3925-3931 e :4195-4201 (db.collection(\"platformConfig\").doc(\"payments\").get() por evento)."
  - effort: "trivial"

## be-architecture-testability

O backend já tem uma cultura forte de extrair lógica pura para módulos testados (payment-rules.ts com 600 linhas de teste, stripe-connect-self-heal.ts, audit-log.ts) — mas 100% dos 32 entrypoints exportados em index.ts têm zero testes, incluindo todos os caminhos de dinheiro (stripeWebhook, createCheckoutSession, requestRefund, issueAdminRefund, dailyReleaseTransfers). O bloqueio é estrutural e pequeno: `db = getFirestore()` em module scope, handlers privados que fecham sobre `db` e chamam `getStripeClient()` inline. Além disso há padrões duplicados sistemáticos (19x check de auth, 5x check de role, 3 implementações da matemática de split de fee — uma delas com um bug de fallback `|| 800` que o próprio código documenta como perigoso) e tipos Firestore divergentes entre functions/src e src/domain (status "released_advance" que o backend nunca escreve). O tratamento de erro Stripe é normalizado apenas nos 3 fluxos de onboarding; refunds, checkout e billing vazam erros opacos "internal" para o cliente.

### refuted (4)

- **[P1] Extrair handlers do stripeWebhook para módulo com injeção de dependência mínima e testá-los**
  - evidence: "Cobertura atual: vitest.config.ts:10 inclui functions/src/**/*.test.ts, mas os únicos 5 arquivos de teste são de helpers puros (functions/src/payment-rules.test.ts, stripe-connect-self-heal.test.ts, audit-log.test.ts, course-analytics.test.ts, course-trending.test.ts). Nenhum dos 32 exports de index.ts (createCheckoutSession index.ts:1912, requestRefund:2673, issueAdminRefund:3478, stripeWebhook:3729, dailyReleaseTransfers:2886) é coberto. Bloqueios concretos: (a) `const db = getFirestore()` em module scope (index.ts:75) — importar index.ts num teste exige initializeApp + emulador; (b) os han
  - effort: "involved"

- **[P1] Normalizar erros Stripe com toStripeHttpsError em TODOS os callables de dinheiro (hoje só onboarding usa)**
  - evidence: "toStripeHttpsError (index.ts:684-728) normaliza StripeError → failed-precondition com a mensagem real e loga type/code/statusCode, mas só é usado em createTeacherStripeAccountLink (index.ts:2544), refreshTeacherStripeAccount (index.ts:2668) e createConnectAccountSession (index.ts:5522). Chamadas Stripe SEM wrapping: requestRefund `stripe.refunds.create` (index.ts:~2784, sem try/catch), issueAdminRefund `stripe.refunds.create` (index.ts:~3578), createCheckoutSession `stripe.checkout.sessions.create` (modo subscription ~index.ts:2029 e one-time ~index.ts:2224), createBillingPortalSession `billi
  - effort: "moderate"

- **[P1] Liberar o checkoutLock quando a criação da sessão Stripe falha**
  - evidence: "O lock é reivindicado na transação em index.ts:~2104-2147 (checkoutLockRef com checkoutUrl: null) ANTES das chamadas Stripe (subscription ~2029, one-time ~2224), e não há try/catch entre claim e publicação da URL (~2239-2247). claimGraceMs = 2 * 60 * 1000 (index.ts:~2102): um claim sem URL só vira 'takeover' depois de 2 min (payment-rules.ts:540-553, branch `ageMs < windows.claimGraceMs ? \"wait\"`), então todo retry dentro da janela recebe HttpsError already-exists (index.ts:~2153-2158)."
  - effort: "moderate"

- **[P1] Centralizar a matemática de split de fee (3 implementações) e corrigir o fallback `|| 800` no caminho de assinatura**
  - evidence: "Canônico: src/domain/payment-split.ts:62-82 (computePaymentSplit), com o próprio header admitindo sync manual ('functions/src/index.ts mirrors ... must be kept in sync', payment-split.ts:12-14). Cópia 1 (one-time): index.ts:4017-4026 — `Math.floor((grossAmountMinor * platformFeeBps) / 10000)` com comentário 'Uses ?? not || so an explicit 0 (Plus plan) survives — `0 || 800` would silently overcharge every Plus-tier sale' (index.ts:4013-4016). Cópia 2 (subscription invoice): index.ts:4250-4260 repete a fórmula inline, e o fallback na linha 4222 é `Number(meta.platformFeeBps ?? 800) || 800` — o 
  - effort: "moderate"

### rest (5)

- **[P2] dailyReleaseTransfers não escala: limit(50) sem filtro releaseAt permite starvation de payouts**
  - evidence: "index.ts:2895-2899: `db.collection(\"payoutLedger\").where(\"status\", \"==\", \"in_release\").limit(50).get()` — sem `where(\"releaseAt\", \"<=\", now)` nem orderBy; o filtro de maturidade é feito em memória (index.ts:~2907-2912, `releaseAtMillis > now → skippedCount`). A janela de retenção default é 30 dias (payment-rules.ts:12), então o conjunto in_release cresce ~30x o volume diário de vendas."
  - effort: "moderate"

- **[P2] Unificar tipos de documentos Firestore divergentes entre functions/src e src/domain (PayoutLedger, title-key, learning outcomes)**
  - evidence: "Drift real: src/domain/payout-ledger.ts:5 declara status \"released_advance\" e src/components/teacher/teacher-wallet-panel.tsx:206,570 filtra por ele, mas grep em functions/src não tem NENHUMA escrita desse status (backend só escreve in_release/releasing/released/refunded/partially_refunded). Inverso: PayoutLedgerRecord do backend (index.ts:~188-242) tem kind, invoiceId, subscriptionId, paymentIdIsPaymentIntent, transferAmountMinor, plannedTransferAmountMinor, releaseAttemptCount, transferReversedAmountMinor — nenhum existe em PayoutLedgerEntry (src/domain/payout-ledger.ts:9-29). Duplicação 
  - effort: "involved"

- **[P2] Helpers requireAuth/requireRole: eliminar 19 cópias do gate de auth e 5 cópias do gate de role**
  - evidence: "19 ocorrências de `if (!request.auth) { throw new HttpsError(\"unauthenticated\", ...)` com 19 mensagens diferentes (index.ts:939, 1001, 1107, 1292, 1347, 1392, 1915, 2250, 2328, 2477, 2552, 2676, 3164, 3323, 3481, 5073, 5155, 5194, 5448). Bloco de 6 linhas 'user doc → roles array → check' repetido 5x: teacher gate idêntico em index.ts:1034 (createTeacherCourseDraft), 1178 (updateTeacherCourseBuilder), 1302 (submitTeacherCourseForReview) — incluindo teacherTermsAcceptedAt e platformFeeBps; admin gate em index.ts:1402 (deleteCourseAsAdmin) e 3488 (issueAdminRefund). Há ainda um sexto formato e
  - effort: "moderate"

- **[P2] Padronizar validação de input dos callables (dois dialetos coexistem)**
  - evidence: "Dialeto A (declarativo): cleanRequiredText(input.courseId, \"Course id\", 3, 160) em index.ts:1113, 1298, 1353, 1398, 2334. Dialeto B (ad-hoc): index.ts:1919 `String(request.data?.courseId || \"\").trim()` + check manual `length > 160`; mesmo padrão em 2254, 2681 (limite 220), 3169 (220), 3328-3329, 3499 (220), 5202 (160). issueAdminRefund parseia amountMinor manualmente com Number()/isInteger (index.ts:3505-3519) — lógica que se repetiria em qualquer futuro callable com valor monetário."
  - effort: "moderate"

- **[P3] Unificar serialização de erros nos logs (3 formatos coexistem) para Cloud Logging consultável**
  - evidence: "Formato 1 (objeto cru, serializa mal): index.ts:2931-2933 `logger.error(\"Payout ledger release failed\", { ledgerId, error })`, index.ts:3761 `logger.warn(\"Stripe webhook signature verification failed\", error)`, index.ts:3886 `logger.error(\"Stripe webhook handling failed\", error)`. Formato 2: `error instanceof Error ? error.message : \"unknown\"` (ex.: index.ts:~3933 receipt URL, ~4245 payout config, ~4305 PaymentIntent resolution). Formato 3: `error instanceof Error ? error.message : String(error)` (ex.: recordAuditEvent index.ts:~929). 9 ocorrências dos formatos 2/3 misturadas."
  - effort: "trivial"

## be-data-model

O modelo Firestore da Skillset tem fundamentos bons — IDs determinísticos consistentes (enrollments `{uid}__{courseId}`, checkoutLocks, courseReviews `{courseId}__{uid}`, certificates docId = enrollmentId, courseTitleKeys para unicidade de título) e denormalização deliberada de snapshot nos docs de dinheiro. Porém, três padrões sistêmicos comprometem escala e até correção: (1) a decisão de nunca versionar composite indexes (firebase.json não tem bloco "indexes") forçou toda a camada de dados a usar `limit()` sem `orderBy`, o que faz superfícies financeiras do professor somarem subconjuntos arbitrários de orders/ledger; (2) o doc do curso embute todas as aulas com `contentText` — os limites validados (500 aulas × 20k chars) permitem documentos de até ~10MB que o Firestore rejeita em 1MiB, e o catálogo público baixa esses docs inteiros; (3) listeners de coleção inteira (memberStats, likes por post, users, posts sem limit) criam custo O(coleção) por viewer. Coleções append-only (processedStripeEvents, rateLimits, pointsEvents) crescem sem TTL.

### refuted (8)

- **[P0] Métricas financeiras do professor somam um subconjunto arbitrário (limit sem orderBy) — números errados a partir da 21ª venda**
  - evidence: "src/lib/data/orders.ts:99-103 — `where(\"teacherId\",\"==\",teacherId), limit(20)` sem orderBy; src/lib/data/orders.ts:69-73 — comentário admite o trade ('NO orderBy... no composite index to deploy. Callers sort by createdAt client-side' — mas ordenar client-side não corrige QUAL subconjunto foi buscado); src/lib/data/payout-ledger.ts:22-26 — `where(\"teacherId\",\"==\",teacherId), limit(50)` sem orderBy; src/components/teacher/teacher-wallet-panel.tsx:191-213 — reduce sobre `orders`/`ledgerEntries` para todos os valores monetários do painel; consumidores: teacher-studio-dashboard.tsx:85, tea
  - effort: "involved"

- **[P0] Doc do curso pode exceder 1MiB: validação aceita 500 aulas × contentText de 20k chars (~10MB) num único documento**
  - evidence: "functions/src/index.ts:472 (até 60 módulos), :491 (até 200 aulas/módulo), :517 (cap total de 500 aulas), :527 — `contentText: cleanOptionalText(lesson.contentText, 20000)` por aula; nenhuma validação de tamanho serializado total; functions/src/index.ts:1257-1276 — `transaction.update(courseRef, { ...modules... })` grava tudo no doc único de courses; src/lib/data/published-courses.ts:169-188 — o frontend consome `course.modules[].lessons[].contentText` direto do doc."
  - effort: "involved"

- **[P1] Catálogo público baixa TODOS os cursos publicados com módulos e contentText completos, sem limit**
  - evidence: "src/lib/data/published-courses.ts:29-32 — `where(\"status\",\"in\",[\"published\",\"in_review\"])` sem limit, doc completo; consumidores: src/components/courses/course-marketplace.tsx:106 (página pública de catálogo), src/components/learn/learner-wishlist.tsx:53, src/components/admin/admin-enrollment-panel.tsx:44; teacherCourseToCourseCard (published-courses.ts:81-126) usa apenas título/preço/rating/cover — o resto do doc é peso morto."
  - effort: "involved"

- **[P1] recordLessonProgress lê a subcoleção progress INTEIRA dentro da transaction a cada toggle de aula**
  - evidence: "functions/src/index.ts:3374-3407 — `transaction.get(progressCollectionRef)` (a coleção toda) + Set para recontar; o denominador vem de extractCourseLessonIds (index.ts:3364); frontend: src/lib/data/lesson-progress.ts:20-27 — onSnapshot na subcoleção progress completa por enrollment."
  - effort: "moderate"

- **[P1] Todo viewer de comunidade assina a coleção memberStats INTEIRA para pintar badges de nível**
  - evidence: "src/lib/data/gamification.ts:83-115 — `onSnapshot(collection(db,\"memberStats\"))` com comentário 'a per-author fetch is the scale-up path'; consumido em src/components/learn/course-community-feed.tsx:106-110 por todo viewer do feed; memberStats é atualizado a cada like via applyCommunityLikeDelta (functions/src/index.ts:1624-1654), então cada like re-push a coleção para todos os viewers."
  - effort: "moderate"

- **[P1] Contagem de likes lê a subcoleção likes inteira por post — denormalizar likeCount que o trigger já sabe calcular**
  - evidence: "src/lib/data/gamification.ts:60-75 — subscribeToPostLikes faz onSnapshot da subcoleção `communityPosts/{postId}/likes` completa e usa `snapshot.size` + likerIds; triggers já existentes: functions/src/index.ts:1671-1687 (onCommunityLikeCreated/onCommunityLikeDeleted) que hoje só creditam pontos ao autor."
  - effort: "moderate"

- **[P1] Feed de comunidade, comentários e reports sem limit/cursor — coleção inteira por visita**
  - evidence: "src/lib/data/community-posts.ts:72-75 — posts por courseSlug sem limit (comentário em :37-39 explica que evitar composite index foi deliberado); :133-147 — subcoleção comments inteira por post; :182-196 — communityReports inteira sem filtro de status nem limit; src/lib/data/admin-users.ts:18-19 — mesmo padrão na coleção users inteira para o admin."
  - effort: "moderate"

- **[P1] Nenhum firestore.indexes.json versionado — a 'proibição' de composite indexes molda (e piora) todas as queries**
  - evidence: "firebase.json:16-18 — bloco firestore contém apenas `\"rules\": \"firestore.rules\"`, sem chave \"indexes\"; não existe firestore.indexes.json na raiz (listagem do diretório); comentários confirmando o constraint: src/lib/data/orders.ts:69-73, src/lib/data/community-posts.ts:37-39; functions/src/index.ts:2840-2844 (sweep sem orderBy/range em createdAt)."
  - effort: "trivial"

### rest (3)

- **[P2] Renomear curso publicado não propaga courseTitle denormalizado — certificados novos saem com título velho**
  - evidence: "functions/src/index.ts:1196 — status 'published' é editável pelo builder; :1257-1264 — update de title sem nenhum fan-out; snapshots criados na compra: index.ts:2154, 2301, 4056, 4358 (`courseTitle: course.title`); emissão do certificado: index.ts:3278 — `courseTitle: enrollment.courseTitle`, sendo que a MESMA transaction já lê o doc do curso em :3247-3249 (usado só para teacherName/assinatura)."
  - effort: "moderate"

- **[P2] Coleções append-only sem TTL: processedStripeEvents, rateLimits e pointsEvents crescem para sempre**
  - evidence: "functions/src/index.ts:3730-3739 — marker em processedStripeEvents por evento (claim/done em payment-rules.ts:446-470), nenhum delete no repo; index.ts:870-905 — enforceRateLimit grava rateLimits/{key} e nunca limpa; index.ts:1656-1668 — pointsEvents append-only; index.ts:1731-1738 — única leitura é a janela 7/30d do rebuildLeaderboards; bônus N+1 no mesmo job: index.ts:1756-1773 faz gets sequenciais de memberStats em loop (trocar por db.getAll)."
  - effort: "trivial"

- **[P3] Reviews do curso: limit(12) sem orderBy mostra 12 avaliações arbitrárias, não as mais recentes/úteis**
  - evidence: "src/lib/data/course-reviews.ts:46-73 — `where(\"courseId\",\"==\",courseId), where(\"status\",\"==\",\"published\"), limit(12)` sem orderBy, seguido de sort client-side por updatedAt sobre o subconjunto truncado; o doc ID determinístico `{courseId}__{userId}` (course-reviews.ts:42-44) torna a ordenação por __name__ correlacionada ao uid do autor, não à data."
  - effort: "trivial"

## be-observability-ops

A base é melhor que a média para um marketplace jovem: webhook Stripe com idempotência two-phase consultável (processedStripeEvents), audit log imutável escrito só pelo Admin SDK, ledger de payout com releaseAttemptCount/lastReleaseError persistidos, e taxonomia PostHog tipada client+server sem PII. O problema é que quase nada disso é OBSERVADO: falhas permanentes de webhook e de transfer ficam em estado de retry silencioso sem alerta nem superfície de ops, os eventos de dinheiro bem-sucedidos (fulfilment, transfer liberada) não geram log estruturado no Cloud Logging (só PostHog, que é no-op sem chave), o audit log cobre apenas 4 ações (delete de curso por admin, decisão de review e mudança de role ficam sem trilha), e não existe health endpoint — hoje "pagamentos quebraram" só é detectável por reclamação de usuário.

### refuted (6)

- **[P0] DLQ e alerta para eventos do stripeWebhook que falham permanentemente**
  - evidence: "functions/src/index.ts:3881 — catch único `logger.error(\"Stripe webhook handling failed\", error)` SEM event.id/event.type no payload estruturado (impossível filtrar por evento no Logs Explorer). functions/src/payment-rules.ts:446-468 — claimStripeEvent/markStripeEventDone: evento que nunca completa fica para sempre com `status: \"processing\"` em processedStripeEvents, mas nenhum código consulta markers presos (único uso da coleção: index.ts:3769-3771). Nenhuma coleção de DLQ, nenhum job de varredura, nada no ops dashboard (src/components/admin/ops-dashboard.tsx:22-29 não tem aba de webhook
  - effort: "moderate"

- **[P0] Transfer de payout que falha re-arma silenciosamente para sempre — sem alerta, sem teto, sem superfície de ops**
  - evidence: "functions/src/index.ts:2926-2940 — catch do release loga \"Payout ledger release failed\" e seta `status: \"in_release\"` + `lastReleaseError`, re-armando para o dia seguinte. index.ts:2994 — claimLedgerForRelease incrementa `releaseAttemptCount`, mas NENHUM código lê esse campo (sem teto, sem escalonamento). index.ts:2943 — summary `logger.info(\"Daily release transfers finished\", { releasedCount, skippedCount, failedCount })` fica em severidade INFO mesmo com failedCount > 0. index.ts:2898 — limit(50)/dia limita a vazão de recuperação de backlog. Grep `payoutLedger` em src/ → só teacher-st
  - effort: "moderate"

- **[P1] Eventos de dinheiro bem-sucedidos não geram log estruturado: fulfilment e transfer liberada são invisíveis no Cloud Logging**
  - evidence: "functions/src/index.ts:3887-4136 — handleCheckoutCompleted: o ÚNICO logger.info é o skip path (\"Checkout fulfilment skipped\", index.ts:4001); o sucesso (payment+order+ledger+enrollment commitados) só emite PostHog checkout_completed (index.ts:4108), que é no-op sem POSTHOG_SERVER_KEY (functions/src/posthog.ts:27-38). releaseLedgerTransfer: caminho de sucesso termina em captureServerEvent PAYOUT_RELEASED (index.ts:3155) sem nenhum logger.info com transferId/amount — dinheiro sai da plataforma sem registro em Cloud Logging (só o agregado releasedCount em index.ts:2943). Contraste: refunds têm
  - effort: "trivial"

- **[P1] Audit log cobre só 4 ações: delete de curso por admin, decisão de review e mudança de role não deixam trilha**
  - evidence: "functions/src/audit-log.ts:15-20 — AUDIT_ACTIONS tem exatamente 4 ações (refund.requested, refund.issued, account.deletion_requested, account.data_export_requested); confirmado pelos labels em src/components/admin/ops-dashboard.tsx:113-118. functions/src/index.ts:1391-1445 — deleteCourseAsAdmin deleta curso + titleKey sem recordAuditEvent e sem nenhum logger.info. src/lib/data/teacher-courses.ts:81-93 — updateCourseReviewStatus (publicar/rejeitar/inativar curso) é updateDoc DIRETO do client, sem passar por função: zero trilha server-side da decisão de moderação. src/lib/data/user-profiles.ts:
  - effort: "moderate"

- **[P1] Painel de payments do ops não mostra nada acionável: 12 pedidos arbitrários, sem fila de pendentes, sem payouts, e total em USD fixo**
  - evidence: "src/lib/data/orders.ts:44-47 — subscribeToRecentOrders: `query(collection(db, \"orders\"), limit(12))` sem orderBy e sem filtro de status (12 documentos arbitrários, não \"recentes\"). src/components/admin/payment-operations-panel.tsx:97 — `[\"Gross paid\", formatMoney(totals.grossMinor, \"USD\")]` hardcoda USD enquanto cada order tem currency própria (formatMoney usa a moeda certa nas linhas individuais, linha 142). src/components/admin/ops-overview-metrics.tsx:74-90 — cards do overview são só courses-in-review/tickets/reports; zero métrica de dinheiro. Nenhum componente admin consome payout
  - effort: "moderate"

- **[P1] Sem health endpoint nem deteção proativa de "pagamentos quebraram"**
  - evidence: "Grep case-insensitive por health|uptime|ping em functions/src → só comentários não relacionados (functions/src/index.ts:4777, functions/src/payment-rules.ts:276). firebase.json:1-73 — nenhum rewrite/endpoint de status. O único onRequest público além do stripeWebhook é verifySkillsetCertificateHttp (functions/src/index.ts:3644+), que não verifica dependências. processedStripeEvents já guarda processedAt por evento (payment-rules.ts:467) — matéria-prima pronta para um \"último webhook processado há X\"."
  - effort: "moderate"

### rest (3)

- **[P2] Telemetria de servidor PostHog falha em silêncio e usa console.* em vez do logger estruturado**
  - evidence: "functions/src/posthog.ts:27-38 — sem POSTHOG_SERVER_KEY todo captureServerEvent é no-op; o aviso único usa console.info (posthog.ts:32). posthog.ts:87 — falha de capture usa console.warn. Eventos afetados: index.ts:4108 (CHECKOUT_COMPLETED), index.ts:3155 (PAYOUT_RELEASED), e o refund em requestRefund (~index.ts:2805). O módulo importa apenas posthog-node, nunca o logger do firebase-functions."
  - effort: "trivial"

- **[P2] Funil de receita incompleto no PostHog: sem evento de mudança de plano e sem refund_issued**
  - evidence: "functions/src/index.ts (~3850, dentro do stripeWebhook) — comentário explícito: \"Plan-subscription billing has no taxonomy event yet (future: plan_upgraded) — intentionally not emitted here\". functions/src/posthog.ts:52-60 — SERVER_EVENTS não tem plan_* nem refund_issued. src/lib/posthog/events.ts:16-32 — idem no client. Em contraste, o restante do funil está fiado: checkout_started/failed (src/components/account/embedded-checkout-panel.tsx:108,129), lesson_started/completed/course_completed (src/components/learn/enrolled-course-workspace.tsx:187,353,367), course_viewed (src/lib/posthog/pag
  - effort: "trivial"

- **[P3] processedStripeEvents cresce sem TTL — um doc por evento Stripe, para sempre**
  - evidence: "functions/src/index.ts:3768-3771 — criação dos markers em processedStripeEvents; functions/src/payment-rules.ts:451,467 — escreve claimedAt/processedAt. Grep por processedStripeEvents em todo o repo → nenhuma deleção, nenhum sweep, nenhuma TTL policy referenciada."
  - effort: "trivial"

## devex-ci-quality

A cultura de documentação é acima da média (DEPLOY.md, docs/operations, runbooks de Stripe), mas a engenharia de entrega é 100% manual: não existe nenhum pipeline de CI (.github/workflows ausente, DEPLOY.md admite "no CI yet"), o deploy parte do working tree de uma máquina de dev — atualmente num branch 11 commits à frente de main, não pushado e com 7 arquivos modificados — e o único "gate" pré-deploy é um lembrete print-only que nunca falha. Dev local não tem modo emulator nem projeto de staging (o único projeto Firebase é o de produção), e a suíte vitest não tem cobertura configurada nem roda os testes de rules no fluxo padrão. Os consertos de maior alavancagem são baratos: um workflow de CI mínimo, transformar o predeploy em gate real e ligar os emulators no client.

### refuted (5)

- **[P0] Criar pipeline de CI mínimo no GitHub Actions (hoje não existe nenhum gate automatizado)**
  - evidence: "Glob .github/**/* → zero arquivos; DEPLOY.md:7 'Manual deploy from a developer machine (no CI yet)'; docs/operations/release-checklist.md:34-36 lista `npm test`/`npm run lint`/`npm run build` como gates manuais; package.json:9-13 já tem todos os scripts necessários (lint, test, test:rules via `firebase emulators:exec --project demo-skillset-rules-test`); .nvmrc = 22; .env.production trackeado com NEXT_PUBLIC_* (gitignore:49-52) permite `next build` em CI sem secrets; repo já está no GitHub (remotes/origin/main; docs/operations/local-development-and-deploy.md:102)."
  - effort: "moderate"

- **[P0] Transformar o predeploy de lembrete print-only em gate que bloqueia deploy com teste quebrado ou working tree sujo**
  - evidence: "scripts/predeploy-reminder.mjs:21 'This script is print-only and must NEVER fail the deploy (always exits 0)'; package.json:14-15 `predeploy:app` roda só o reminder, nenhum teste; firebase.json:12-14 predeploy só compila functions (`npm --prefix $RESOURCE_DIR run build`); estado real verificado: `git status` mostra 7 arquivos modificados (functions/src/index.ts, firebase.json, next.config.ts, 4 componentes) + untracked; `git rev-list --left-right --count main...HEAD` = 0/11 (branch 11 commits à frente de main local); `git branch -a` mostra que fix/payment-subscription-and-demo-cta não existe 
  - effort: "moderate"

- **[P1] Dev local roda contra o projeto Firebase de produção — adicionar modo emulator e considerar staging**
  - evidence: "firebase.json (lido integral, linhas 1-73) não possui bloco 'emulators'; src/lib/firebase/client.ts:16-38 inicializa app/auth/firestore/storage/functions sem nenhuma chamada connect*Emulator (Grep por connectFirestoreEmulator|connectAuthEmulator|connectStorageEmulator|connectFunctionsEmulator em src/ → zero matches); src/lib/firebase/config.ts:4-11 lê apenas NEXT_PUBLIC_FIREBASE_* sem flag de ambiente; .firebaserc:1-5 contém um único projeto ('default': 'skillsetusaofficial') — não há staging; o emulador só é usado para rules tests com projeto demo (package.json:11)."
  - effort: "involved"

- **[P1] Fechar a janela de divergência rules vs app: gate por hash em vez de lembrete**
  - evidence: "package.json:14-17 — deploy:app = `--only functions,hosting`, deploy:rules = `--only storage,firestore:rules`, deploy:full = app **depois** rules (código novo roda contra rules velhas durante a janela); DEPLOY.md:42-51 documenta o incidente real: storage.rules endurecida no commit c80d2a3 'committed but never deployed' deixou upload de capa em HTTP 403 'for a long time'; scripts/predeploy-reminder.mjs:20-22 é explicitamente print-only."
  - effort: "moderate"

- **[P1] Configurar cobertura no vitest e corrigir a fragmentação das suítes (functions testadas sob jsdom, rules fora do fluxo)**
  - evidence: "vitest.config.ts:4-12 — sem bloco `coverage`, `environment: 'jsdom'` global e include misturando `src/**/*.test.tsx` com `functions/src/**/*.test.ts` (testes de Cloud Functions executando em ambiente DOM); package.json:34-51 — nenhum @vitest/coverage-v8 nas devDependencies; vitest.rules.config.ts:8 — rules tests (tests/firestore-rules.ts, tests/storage-rules.ts) vivem em config separada acionada só por test:rules; TEST_RESULTS.md:1-12 é um log manual de validação de split financeiro (inclusive com drift interno: tabela espera 'releaseAt ≈ now + 10d' enquanto o texto cita decisão D21 de 30 dia
  - effort: "moderate"

### rest (3)

- **[P2] Alinhar versões do SDK Stripe e da apiVersion entre functions de produção e scripts de ops**
  - evidence: "functions/package.json:16 — stripe ^20.4.1 (produção); package.json:46 — stripe ^22.1.1 (root devDependency, usada pelos scripts); functions/src/index.ts:671-673 — `new Stripe(result.key, { apiVersion: '2026-02-25.clover' as Stripe.LatestApiVersion })` (o cast existe porque os typings do v20 não incluem essa versão); scripts/setup-stripe-billing.mjs:98 — `new Stripe(SECRET, { apiVersion: '2025-06-30.basil' })`; scripts/stripe-test-e2e.mjs:72 — `new Stripe(key)` sem apiVersion (default da major instalada)."
  - effort: "moderate"

- **[P2] Atualizar o README raiz (estado de 2026-04-20) e completar o caminho de onboarding de um dev novo**
  - evidence: "README.md:4 'Updated: 2026-04-20'; README.md:120-128 lista como próximos passos 'Add real auth and role gating', 'Add teacher onboarding flow', 'Add student lesson/player flow' — todos shipped (src/app cobre /account/payments, checkout, certificados; git log mostra waves de payments/community em junho); README.md:81-89 instrui apenas `npm install` + `npm run dev`, omitindo `npm --prefix functions install` (que docs/operations/local-development-and-deploy.md:22-25 exige) e o setup de .env.local; .env.example:1-9 lista as chaves NEXT_PUBLIC_FIREBASE_* vazias sem dizer onde obtê-las; src/lib/fir
  - effort: "trivial"

- **[P2] Higiene git: ignorar artefatos de runtime do agente/logs e bloquear deploy de arquivos untracked em functions/src**
  - evidence: "git status: untracked `.claude/jarvis/`, `.claude/logs/`, `.claude/mission-control/`, `.claude/sessions/`, `logs/`, `docs/PROMPT-MELHORIA-CONTINUA.md` e `functions/src/diag-connect-probe.ts`; .gitignore:60 ignora apenas `.gstack/` (nenhuma entrada para `/logs/` raiz nem subdirs de runtime de .claude/, embora .claude/launch.json seja trackeado de propósito); functions/tsconfig.json:15 `include: ['src']` + firebase.json:12-14 predeploy `npm --prefix $RESOURCE_DIR run build` ⇒ todo arquivo em functions/src vai para lib/ e embarca no `firebase deploy --only functions`, trackeado ou não."
  - effort: "trivial"
