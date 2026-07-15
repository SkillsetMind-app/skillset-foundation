# Phase 1: Vídeo híbrido - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Source:** PRD Express Path (`PS8-OS\03-projetos\skillsetmind\HANDOFF-SESSAO-VIDEO-HIBRIDO.md` + VIABILIDADE §3/§6 + DESIGN-CLONE-SPEC + recon do codebase nesta sessão)

<domain>
## Phase Boundary

Aula do curso aceita duas fontes de vídeo escolhidas EXPLICITAMENTE pelo criador (modelo Eduzz): (a) YouTube embed — cola URL, valida/normaliza para `youtube-nocookie`; (b) upload nativo — storage abstraído (Bunny Stream quando configurado, Supabase Storage como fallback). Campo `videoSource: 'youtube' | 'upload'` na lição. Player do aluno respeita a escolha. Lições existentes seguem funcionando.

**Fora da fase:** trocar/contratar provedor de vídeo, mexer no pipeline TUS/token/entitlement do Bunny, assinatura, IA conselheira, 1:1.
</domain>

<decisions>
## Implementation Decisions

### Estado atual do código (recon 2026-07-15 — NÃO reconstruir o que já existe)
- `src/domain/lesson-embed.ts` + testes: `getTrustedLessonEmbed()` já valida watch/youtu.be/shorts/live/embed → `https://www.youtube-nocookie.com/embed/{id}`; aceita Vimeo. MANTER como única porta de embed.
- Upload nativo já roteia: `lesson-content-modal.tsx` → `uploadLessonVideoToBunny` (TUS, 5GB, `isBunnyConfigured`) OU `uploadCourseAsset` (Supabase Storage, 500MB). `CourseAsset.bunnyVideoId` distingue os dois. A abstração pedida no handoff JÁ EXISTE.
- Playback do aluno: `enrolled-course-workspace.tsx` `LessonContentPanel` — precedência hardcoded `primaryHostedVideo` > `trustedEmbed` (linhas ~1279-1331); `BunnyVideoPlayer` (token via `/api/courses/video-token` + `canViewCourseAssetVideo` — gate de entitlement, NÃO REMOVER) ou `ProtectedAssetPreview` (URL assinada Storage).
- Persistência: lições vivem no array `modules` serializado no doc do curso (`normalizeTeacherCourseModules` em `src/domain/teacher-course.ts`); conteúdo da lição espelhado em subcoleção gated ("post-strip"). `TeacherLesson` hoje: id, title, type, description, durationMinutes, contentText, externalUrl, dripDelayDays, thumbnailAssetId.
- Preview público do criador: `creator-course-detail.tsx` também usa `getTrustedLessonEmbed` (linha ~222) — precisa respeitar `videoSource` também.

### Locked (do handoff/decisões travadas)
- Campo `videoSource: 'youtube' | 'upload'` explícito na lição (naming camelCase segue o padrão do domínio TS; na serialização segue o formato dos demais campos da lição).
- Seletor de fonte estilo Eduzz na aba Video do modal (`lesson-content-modal.tsx`): escolha explícita, só o input da fonte ativa visível; trocar de fonte não destrói dados da outra.
- Privacidade YouTube: `youtube-nocookie` (já é o comportamento — manter).
- Retrocompat por inferência (VID-06): sem `videoSource` → asset de vídeo presente = `upload`; senão embed confiável = `youtube`; senão null/sem mídia. A inferência vive numa função pura no domínio, com teste.
- Design da aba Video: DESIGN-CLONE-SPEC — radius 6px (botão sólido) / 8px (superfícies), alturas 40-44px, Ink Indigo `#14182B` + Brass `#C6A15B`, headings pesados, Lucide.
- Git: trabalho no branch `feat/issue-2-hybrid-video` (issue #2); commit direto na main proibido; PR ao final.

### Claude's Discretion
- Forma exata do seletor (segmented control vs radio cards) dentro da anatomia 40-44px/6-8px.
- Se `videoSource` também aparece no tipo `Lesson` do lado do aluno ou se o player resolve via mapper — decidir pelo menor diff que satisfaça VID-05.
- Tratamento de `live_recording` (upload) e Vimeo (fonte "youtube" é rótulo do produto; tecnicamente = embed confiável) — manter capacidades atuais sem inflar UI.
- Copy consultiva EN (produto é EN-first).
</decisions>

<specifics>
## Specific Ideas

- Eduzz model: criador que já tem canal cola o link do YouTube (custo de vídeo zero pra plataforma); criador premium sobe nativo. Ambos em todos os planos (doc-norte §9.6).
- Bug latente que a fase corrige: hoje se a aula tem asset E URL do YouTube, o asset ganha silenciosamente e a URL "some" para o aluno — com `videoSource` explícito isso vira escolha visível do criador.
</specifics>

<deferred>
## Deferred Ideas

- Plugar conta Bunny em produção (env vars) — operacional, não código; a abstração já cobre.
- Duração/thumbnail automáticos a partir do YouTube (oEmbed) — nice-to-have, não bloqueia.
- Quiz/assignment authoring (escondido de propósito — ver comentário em `lesson-content-modal.tsx`).
</deferred>

---

*Phase: 01-video-hibrido*
*Context gathered: 2026-07-15 via PRD Express Path + recon de código*
