# Phase 1: Vídeo híbrido - Research

**Researched:** 2026-07-15
**Domain:** Next.js App Router + Supabase (Postgres/RLS/RPC) internal feature — no new external dependency
**Confidence:** HIGH (all findings verified by reading the actual source files and CSS in this repo) except one item marked LOW (the live Postgres RPC body, which is not versioned in this repo — see Risks #1)

## Summary

This phase adds one explicit field (`videoSource: 'youtube' | 'upload'`) to the lesson model and a source-picker UI. The two building blocks it depends on — `getTrustedLessonEmbed()` (YouTube/Vimeo → `youtube-nocookie` embed) and the Bunny/Supabase upload abstraction — already exist and are already tested; this phase does not touch them.

The real work is entirely in **field plumbing and precedence logic**, and the codebase has **two independent normalization/mapping choke points** that a new lesson field must pass through by hand, plus **one opaque, unversioned server-side choke point** that must be verified before the plan can be trusted:

1. `normalizeTeacherCourseModules()` in `src/domain/teacher-course.ts` — the single function used by both the live save payload and the change-signature baseline for the builder. Add `videoSource` here or it's silently dropped on save.
2. `teacherCourseToLearningCourse()` in `src/lib/data/published-courses.ts` — an explicit per-lesson field allowlist that maps `TeacherLesson` → student-facing `Lesson`. It currently copies `contentText`/`externalUrl`/`dripDelayDays` but not a video-source hint at all. Add `videoSource` here or the player never sees it even though it's saved correctly in Postgres.
3. **The `update_teacher_course_builder` Postgres RPC (SECURITY DEFINER)** — the actual writer of the `courses.modules` JSONB column. Its SQL body is **not in this repo** (the local `supabase/migrations/` folder only contains changes since 2026-07-04; this RPC predates that and lives only in the live database). It already re-derives some course-level fields server-side rather than trusting the client payload blindly (confirmed by a code comment). Whether it also re-derives/allowlists *lesson-level* fields is unknown from static analysis alone — this must be checked against the live database (via Supabase MCP `execute_sql` → `pg_get_functiondef`, or `supabase db pull`) before or during planning, because if it allowlists lesson fields, `videoSource` will be silently dropped exactly like `contentText`/`externalUrl` were pre-B1.

Everything else — the gated `course_lesson_content` table, the builder's autosave/patch/change-signature flow, RLS, the video-token route — does not need to change for this phase. `videoSource` is not sensitive/paywalled content (it reveals nothing about a locked lesson), so it belongs only in the world-readable `courses.modules` JSONB, not in the gated table.

**Primary recommendation:** Add `videoSource?: 'youtube' | 'upload' | null` to `TeacherLesson` and `Lesson`; thread it through the two mapper choke points listed above; write one pure inference function (VID-06) colocated in `src/domain/teacher-course.ts`; replace the hardcoded `primaryHostedVideo > trustedEmbed` precedence in `enrolled-course-workspace.tsx` with an explicit switch on `videoSource` (falling back to the inference function when absent); build the picker as its own small, dependency-free component so it can be unit-tested the same lightweight way `members-area-hero.test.tsx` already is; and — before finalizing the plan — confirm the RPC's actual behavior against the live database rather than assuming pass-through.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VID-01 | Lesson has explicit `videoSource` persisted with the course | Field survival chain section: add to `TeacherLesson`, normalize in `normalizeTeacherCourseModules()`, verify RPC pass-through (Risk #1) |
| VID-02 | Eduzz-style source picker in the Video tab; only active source's input visible | Architecture Patterns section: exact insertion point in `lesson-content-modal.tsx` (current Video tab structure), `onUpdateLesson` patch contract already supports this with zero changes |
| VID-03 | YouTube URL validated/normalized to `youtube-nocookie` embed | Already implemented and tested (`src/domain/lesson-embed.ts` + `lesson-embed.test.tsx`) — reuse verbatim, do not modify |
| VID-04 | Upload stays behind existing Bunny/Supabase storage abstraction | Confirmed untouched by this phase; `uploadLessonVideoToBunny`/`uploadCourseAsset`/`isBunnyConfigured` need no changes |
| VID-05 | Player respects `videoSource` explicitly, no hardcoded precedence | Field survival chain + Risks section: exact lines to change in `LessonContentPanel()` (`enrolled-course-workspace.tsx` L1279-1331) |
| VID-06 | Legacy lessons without `videoSource` infer correctly | Don't Hand-Roll / Architecture Patterns: one pure function, 3 call sites identified, 1 call site (public preview) has a pre-existing structural limit documented in Risks |
| VID-07 | Video tab follows DESIGN-CLONE-SPEC (radius, heights, Ink Indigo/Brass) | Design Implementation Surface section: exact CSS file/line ranges, which tokens already match spec (radius) and which do not exist yet (color) |
</phase_requirements>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- `src/domain/lesson-embed.ts` + testes: `getTrustedLessonEmbed()` já valida watch/youtu.be/shorts/live/embed → `https://www.youtube-nocookie.com/embed/{id}`; aceita Vimeo. MANTER como única porta de embed.
- Upload nativo já roteia: `lesson-content-modal.tsx` → `uploadLessonVideoToBunny` (TUS, 5GB, `isBunnyConfigured`) OU `uploadCourseAsset` (Supabase Storage, 500MB). `CourseAsset.bunnyVideoId` distingue os dois. A abstração pedida no handoff JÁ EXISTE.
- Playback do aluno: `enrolled-course-workspace.tsx` `LessonContentPanel` — precedência hardcoded `primaryHostedVideo` > `trustedEmbed` (linhas ~1279-1331); `BunnyVideoPlayer` (token via `/api/courses/video-token` + `canViewCourseAssetVideo` — gate de entitlement, NÃO REMOVER) ou `ProtectedAssetPreview` (URL assinada Storage).
- Persistência: lições vivem no array `modules` serializado no doc do curso (`normalizeTeacherCourseModules` em `src/domain/teacher-course.ts`); conteúdo da lição espelhado em subcoleção gated ("post-strip"). `TeacherLesson` hoje: id, title, type, description, durationMinutes, contentText, externalUrl, dripDelayDays, thumbnailAssetId.
- Preview público do criador: `creator-course-detail.tsx` também usa `getTrustedLessonEmbed` (linha ~222) — precisa respeitar `videoSource` também.
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

### Deferred Ideas (OUT OF SCOPE)
- Plugar conta Bunny em produção (env vars) — operacional, não código; a abstração já cobre.
- Duração/thumbnail automáticos a partir do YouTube (oEmbed) — nice-to-have, não bloqueia.
- Quiz/assignment authoring (escondido de propósito — ver comentário em `lesson-content-modal.tsx`).

## Project Constraints (from CLAUDE.md)

No project-level `CLAUDE.md` exists inside `skillset-foundation/`. The nearest `CLAUDE.md` (`C:\Users\nicae\aiox-core\.claude\CLAUDE.md`) governs the parent `aiox-core` **framework** repo (agent roles, `@dev`/`@devops`/etc., CLI-first architecture) and does not apply to this Next.js application's code conventions. The applicable conventions were instead reverse-engineered from the codebase itself (see Architecture Patterns): TypeScript strict domain/data/component layering, `"use client"` data modules calling `getSupabaseBrowserClient()`, colocated `*.test.tsx` vitest tests even for non-JSX domain files, and inline CSS custom properties in `src/app/globals.css` (no CSS-in-JS, no Tailwind config for design tokens — Tailwind is used for layout utilities only, tokens are plain CSS vars consumed via `var(--...)`).

## Field Survival Chain

Every file/symbol `videoSource` must pass through, in save order (builder → DB) then in read order (DB → player):

### Write path (builder → Postgres)

| # | File : Symbol | What must change | Confidence |
|---|---|---|---|
| 1 | `src/domain/teacher-course.ts` : `TeacherLesson` type (L60-70) | Add `videoSource?: 'youtube' \| 'upload' \| null;` | HIGH |
| 2 | `src/domain/teacher-course.ts` : `normalizeTeacherCourseModules()` (L265-287) | Add `videoSource: normalizeVideoSource(lesson.videoSource)` (or equivalent) inside the `lessons.map(...)` block. **This is the single choke point** — it's the only place lesson fields get serialized for both the live RPC payload (`teacher-courses.ts` calls it directly) and the change-signature baseline (`builderDraftSignatureFromCourse()` in `course-builder-studio.tsx` calls the same function via `buildBuilderDraftPayload()`). Missing this = field silently dropped on every save, and the change-signature would never notice a source-only edit as "dirty" if the field isn't included symmetrically on both sides (it is, automatically, as long as this one function is updated). | HIGH |
| 3 | `src/domain/teacher-course.test.tsx` (L110-154) | Existing test does an exact `.toEqual()` on `normalizeTeacherCourseModules()` output. **Adding the field breaks this test immediately** unless both the input fixture and expected output are updated to include `videoSource`. Not optional — this is a guaranteed regression, not a maybe. | HIGH |
| 4 | `src/components/teacher/course-builder-studio.tsx` : `updateLesson()` (L1115-1137) | No change needed — already a generic `{ ...lesson, ...patch }` merge driven by `Partial<TeacherLesson>`. The new picker calls `onUpdateLesson({ videoSource: 'upload' })` and it just works. | HIGH |
| 5 | `src/components/teacher/course-builder-studio.tsx` : new-lesson creation object (L999-1020) | Decide whether new lessons get an explicit `videoSource` (e.g. `null`) or omit the key entirely (falls to inference, consistent with VID-06 default-to-empty state). Either is safe; omitting is the smaller diff. | HIGH |
| 6 | `src/components/teacher/lesson-content-modal.tsx` : Video tab body (L353-439) | This is where the actual picker UI goes — see Architecture Patterns for the exact insertion point and what to conditionally hide. | HIGH |
| 7 | `src/lib/data/teacher-courses.ts` : `updateTeacherCourseBuilder()` (L60-113) | No change needed — `modules: normalizeTeacherCourseModules(input.modules)` already forwards whatever the normalize function produces into `p_payload` sent to the RPC. | HIGH |
| 8 | **Postgres RPC `update_teacher_course_builder` (SECURITY DEFINER)** | **Not in this repo.** Must be inspected on the live database. See Risks #1 — this is the one genuinely unverified link in the chain. | **LOW** |
| 9 | `src/lib/supabase/database.types.ts` : `courses` table `modules` column | Typed as opaque `Json`, not a structured column — no type regeneration needed for `videoSource` itself (it rides inside the existing JSONB blob). Only regenerate if the RPC signature/columns change. | HIGH |

### Read path (Postgres → student player)

| # | File : Symbol | What must change | Confidence |
|---|---|---|---|
| 10 | `src/lib/data/published-courses.ts` : `rowToTeacherCourse()` (L30-70) | No change needed — casts `row.modules as unknown as TeacherCourseModule[]` as an opaque blob, so `videoSource` survives this cast automatically. | HIGH |
| 11 | `src/lib/data/published-courses.ts` : `teacherCourseToLearningCourse()` (L279-353, lesson mapping L326-338) | **Second choke point.** This is an explicit per-field allowlist (`id, title, type, duration, isPreview, description, contentText, externalUrl, dripDelayDays`) — `thumbnailAssetId` is already dropped here by design, and `videoSource` would be dropped the same way unless added explicitly: `videoSource: lesson.videoSource ?? null`. | HIGH |
| 12 | `src/domain/learning.ts` : `Lesson` type (L22-32) | Add `videoSource?: 'youtube' \| 'upload' \| null;` | HIGH |
| 13 | `src/components/learn/enrolled-course-workspace.tsx` : `resolvedSelectedLesson` (L388-396) | No change needed — spreads `selectedLesson` (will carry `videoSource` once added) then overlays only `{ contentText, externalUrl }` from `resolveLessonContent()`. `videoSource` passes through the spread untouched. | HIGH |
| 14 | `src/components/learn/enrolled-course-workspace.tsx` : `LessonContentPanel()` (L1279-1331) | **This is the VID-05 fix.** Replace the hardcoded `primaryHostedVideo` / `trustedEmbed` precedence with an explicit branch on `lesson.videoSource` (or the inferred value when absent — see VID-06 function). See Common Pitfalls for the exact current logic and what's wrong with it. | HIGH |
| 15 | `src/components/courses/creator-course-detail.tsx` (L198-224) | Works directly on `TeacherCourse.modules` (`TeacherLesson`, **not** the mapped `Lesson`) — `lesson.videoSource` is available here automatically once step 1 is done, no extra mapping required. Only the *usage* of `previewLessonEmbed` needs to respect it (gate rendering when `videoSource === 'upload'`, matching VID-05's "and vice versa"). See Risks #2 for a pre-existing structural limit in this component. | HIGH |
| 16 | `docs/technical/data-model.md` : Lesson field table (L83-96) | Not code, but this doc explicitly documents every `TeacherLesson` field and will silently go stale if not updated. Low priority, cheap to include. | HIGH |

### Where `videoSource` explicitly does NOT need to go

- **`course_lesson_content` table / `src/lib/data/lesson-content.ts`** — this table only mirrors `content_text` and `external_url` for enrollment-gated access. `videoSource` is a routing flag, not paywalled content (it reveals nothing about a locked lesson's media), so it stays inline-only in `courses.modules`, same class as `lesson.type` or `durationMinutes`. No RLS/migration change needed for this table.
- **`course_assets` table / `src/domain/course-asset.ts` / `CourseAsset` type** — assets are looked up by `lessonId`, independently of `videoSource`. No new column needed there.

## Standard Stack

No new library is required for this phase — everything needed already ships in the repo.

| Concern | What to use | Why |
|---|---|---|
| YouTube/Vimeo URL parsing | `getTrustedLessonEmbed()` (`src/domain/lesson-embed.ts`) | Already implements watch/youtu.be/shorts/live/embed → `youtube-nocookie`, plus Vimeo. Tested (`lesson-embed.test.tsx`). Do not re-implement. |
| Video upload (native) | `uploadLessonVideoToBunny()` / `uploadCourseAsset()` (`src/lib/data/course-assets.ts`) | Existing Bunny-TUS-vs-Supabase-Storage abstraction, gated by `isBunnyConfigured`. Out of scope for this phase (VID-04 explicitly keeps it as-is). |
| Icons | `lucide-react` (already a dependency, already imported in `lesson-content-modal.tsx`: `Film`, `UploadCloud`, `Link2`, etc.) | Matches DESIGN-CLONE-SPEC's explicit "Lucide, que já usamos" instruction — no new icon set. |
| Component tests | `vitest` 3.2.6 + `@testing-library/react` (both already devDependencies) | Confirmed via `package.json` and the one existing component test, `src/components/learn/members-area-hero.test.tsx`. |

## Architecture Patterns

### Pattern 1: Single normalize choke point for lesson fields (already established, extend it)
**What:** `normalizeTeacherCourseModules()` in `src/domain/teacher-course.ts` is the one function both the manual-save payload and the autosave change-signature run through (`buildBuilderDraftPayload()` in `course-builder-studio.tsx` calls it; `updateTeacherCourseBuilder()` in `teacher-courses.ts` calls it again independently but with the same logic). Any new lesson field added here is automatically symmetric between "what gets saved" and "what counts as dirty."
**When to use:** Any time a new `TeacherLesson` field is added.
**Example (existing code, extend the `lessons.map` block):**
```typescript
// Source: src/domain/teacher-course.ts L265-287 (current)
export function normalizeTeacherCourseModules(
  modules: TeacherCourseModule[],
): TeacherCourseModule[] {
  return modules.map((module) => ({
    ...module,
    // ...
    lessons: module.lessons.map((lesson) => ({
      ...lesson,
      title: lesson.title.trim(),
      description: lesson.description.trim(),
      durationMinutes: normalizeNullableNumber(lesson.durationMinutes),
      contentText: normalizeNullableText(lesson.contentText),
      externalUrl: normalizeNullableText(lesson.externalUrl),
      dripDelayDays: /* ... */,
      thumbnailAssetId: normalizeNullableText(lesson.thumbnailAssetId),
      // ADD: videoSource: normalizeVideoSource(lesson.videoSource),
    })),
  }));
}
```

### Pattern 2: Explicit-source precedence instead of asset-presence precedence
**What:** `LessonContentPanel()` currently derives what to render from *what data happens to exist* (an asset? use it. else a parseable URL? use that.) rather than from a stored choice. This is the exact bug VID-05 fixes.
**When to use:** VID-05.
**Current code (the bug):**
```typescript
// Source: src/components/learn/enrolled-course-workspace.tsx L1279-1293 (current, to replace)
const primaryHostedVideo = locked
  ? null
  : assets.find(
      (asset) =>
        (asset.kind === "lesson_video" || asset.kind === "live_recording")
        && asset.contentType.startsWith("video/"),
    ) ?? null;
// ...
const trustedEmbed = locked || primaryHostedVideo
  ? null
  : getTrustedLessonEmbed(lesson.externalUrl);
```
Note the `locked || primaryHostedVideo` guard on `trustedEmbed` — an asset (even an orphaned leftover one) always wins over the embed today, regardless of what the creator actually wants. Replace with a branch keyed on `lesson.videoSource ?? inferLessonVideoSource(...)`.

### Pattern 3: Radio-card picker anatomy already exists in this exact modal — reuse the pattern, not the CSS
**What:** `lesson-content-modal.tsx` already renders a 2-up radio-card picker for "Upload lesson video" vs "Upload live recording" (L367-388, `.lesson-modal-choice` buttons with an `is-active` class toggle). The new YouTube/Upload picker is structurally the same pattern (2 mutually-exclusive buttons, `is-active` styling, disabled while `!isEditable`).
**When to use:** VID-02's picker.
**Why not reuse the CSS as-is:** `.lesson-modal-choice` uses `border-radius: 14px` and a crimson active border (`rgba(178, 34, 52, 0.35)`, which resolves to the old `--color-primary`) — neither matches the locked DESIGN-CLONE-SPEC anatomy (6-8px radius, Ink Indigo/Brass). See Design Implementation Surface below.

### Recommended insertion point for the picker (VID-02)
Inside `lesson-content-modal.tsx`'s `tab === "video"` block (L353-439), directly under the `lesson-modal-video` header banner (L355-365) and above the current unconditional stack of upload-choice buttons + YouTube URL field. Gate the two existing blocks on the resolved source:
```typescript
const resolvedSource = lesson.videoSource ?? inferLessonVideoSource({
  hasVideoAsset: videoAssets.length > 0,
  trustedEmbed,
});
// if resolvedSource === "upload": render the existing upload-choice buttons + LessonUploadForm + asset list, HIDE the URL field
// if resolvedSource === "youtube": render the existing URL input + inline-status, HIDE the upload UI
// switching source via onUpdateLesson({ videoSource: "upload" | "youtube" }) — never clears externalUrl or deletes assets
```
This satisfies "trocar de fonte não destrói dados da outra" for free — nothing in this component currently clears `externalUrl` or deletes assets on tab/source change, so simply hiding (not unmounting-and-losing-state) the inactive input is a pure visibility change.

### Anti-Patterns to Avoid
- **Do not reintroduce asset-presence-based precedence in the inference function's *call sites* on the player.** The inference function is only for legacy lessons that have no `videoSource` at all (VID-06). Once a lesson has an explicit `videoSource`, the player must never fall back to "well there's an asset, so show it anyway."
- **Do not touch `--color-accent` / `--color-primary` globally to satisfy VID-07.** Those tokens are consumed in hundreds of places across the whole "Cosmos" skin; the DESIGN-CLONE-SPEC source doc itself scopes the full reskin to a later session (see Design Implementation Surface / Risks #3). Scope the new colors to the new picker component only.
- **Do not add `videoSource` to `course_lesson_content`.** It isn't gated content — see "Where videoSource explicitly does NOT need to go" above.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| YouTube/Vimeo URL → embed | A new regex/parser | `getTrustedLessonEmbed()` | Already handles watch/youtu.be/shorts/live/embed + Vimeo, already tested, already wired into 3 components. Locked decision explicitly says keep as the only embed door. |
| Video file upload | A new upload flow | `uploadLessonVideoToBunny()` / `uploadCourseAsset()` | Bunny-vs-Supabase abstraction + entitlement gate already exists and is explicitly out of scope (VID-04). |
| Legacy-lesson source detection | Ad-hoc `if` chains repeated in 2-3 components | One pure function (see below) | The locked decision explicitly requires "a inferência vive numa função pura no domínio, com teste" — and there are 2-3 call sites (builder modal, player, arguably preview) that must all agree on the same logic or legacy lessons will render inconsistently between builder and player. |

**Key insight:** This phase has almost no "build vs buy" tension — the tension is entirely about *not duplicating the same small piece of logic across multiple UI surfaces* that all need to answer the same question ("what does this lesson currently play?") from slightly different available data (the builder has `videoAssets` from a live subscription; the player has `assets` already filtered to the current lesson; the public preview has neither).

### Inference function contract (VID-06)
Recommended signature and home:
```typescript
// Recommended: src/domain/teacher-course.ts (colocated with TeacherLesson),
// tested in src/domain/teacher-course.test.tsx (same pattern as the other
// normalize* functions in that file).
export function inferLessonVideoSource(params: {
  hasVideoAsset: boolean;
  hasTrustedEmbed: boolean;
}): "upload" | "youtube" | null {
  if (params.hasVideoAsset) return "upload";
  if (params.hasTrustedEmbed) return "youtube";
  return null;
}
```
Call sites and what each one can supply for `hasVideoAsset`/`hasTrustedEmbed`:
- `lesson-content-modal.tsx`: `videoAssets.length > 0` (already computed, L130-132) / `Boolean(trustedEmbed)` (already computed, L135).
- `enrolled-course-workspace.tsx` `LessonContentPanel()`: `assets.some(...)` (same predicate as the current `primaryHostedVideo` finder) / `Boolean(getTrustedLessonEmbed(lesson.externalUrl))`.
- `creator-course-detail.tsx`: **cannot supply `hasVideoAsset`** — this component never fetches `course_assets` at all (confirmed by imports/grep). Its free-preview lesson can only ever infer `youtube` or `null`, matching its current behavior of only ever rendering an embed. This is not a regression to fix in this phase (see Risks #2).

## Common Pitfalls

### Pitfall 1: Believing the two normalize functions are "the same list"
**What goes wrong:** `normalizeTeacherCourseModules()` (write path) and `teacherCourseToLearningCourse()`'s per-lesson map (read path) look similar but are two independently-hand-maintained field lists in two different files. `thumbnailAssetId` is proof this already diverges today (present in the write-side type, silently absent from the read-side `Lesson` type) — this is expected/intentional there, but it means "add the field to `TeacherLesson`" is not sufficient; the read-side allowlist must be edited too, or the symptom will look exactly like "it saved but the player doesn't see it," which will read as a bug in the picker when the picker is actually fine.
**Why it happens:** No shared/derived type — both lists are written out by hand.
**How to avoid:** Treat both files (item 2 and item 11 in the Field Survival Chain) as one atomic edit in the same task/commit.
**Warning signs:** In manual testing, the builder modal shows the right source after reload (proves write + `rowToTeacherCourse` are fine) but the student classroom shows the old precedence behavior (proves the read-side mapper is the gap).

### Pitfall 2: Trusting the "Cloud Function" comments literally
**What goes wrong:** Several comments in `teacher-course.ts` and `course-builder-studio.tsx` (e.g. "the client always sends the real lesson content to the Cloud Function... the function is the single authoritative writer of the gated courses/{id}/lessonContent subcollection") describe a **pre-migration Firebase architecture**. This repo has since cut over to Supabase: there is no Cloud Function anymore, only a Postgres RPC (`update_teacher_course_builder`) and a plain table (`course_lesson_content`) with realtime subscriptions. `docs/technical/architecture.md` L19 still literally says "Backend functions: Firebase Cloud Functions v2, Node.js 22" — also stale.
**Why it happens:** Comments and one architecture doc were not updated during the June 2026 Firebase→Supabase cutover (`docs/plans/2026-06-30-firebase-cutover-map.md`).
**How to avoid:** When the plan references "the Cloud Function," mentally substitute "the `update_teacher_course_builder` RPC." Do not assume Firestore security-rules semantics apply — this is now Postgres RLS + a SECURITY DEFINER function.
**Warning signs:** None at runtime — this is a documentation-only trap, but it will mislead anyone reading the code cold.

### Pitfall 3: Assuming `supabase/migrations/` is a complete schema history
**What goes wrong:** The local migrations folder only has 7 files, all dated 2026-07-04 or later. The `courses` table, `course_lesson_content` table, `update_teacher_course_builder` RPC, and the RLS policies they depend on all predate this folder and were applied directly to the live database (confirmed: `20260704_tighten_content_access_and_rpc_grants.sql` uses `alter policy ... using (...)`, i.e. it edits a policy whose original `create policy` is not in this repo). Anyone reading only `supabase/migrations/` will underestimate what already exists and cannot see the RPC's actual current SQL body.
**How to avoid:** For anything touching the RPC or `course_lesson_content` RLS, verify against the live database (Supabase MCP `execute_sql`, or `supabase db pull`) rather than grepping this repo and concluding "not found = doesn't exist."
**Warning signs:** `grep`/`Grep` for a table or function name that you know is used in application code (confirmed by `database.types.ts` or a `.rpc(...)` call) returns zero hits in `supabase/migrations/`.

## Code Examples

### Current Video tab structure to modify (VID-02)
```tsx
// Source: src/components/teacher/lesson-content-modal.tsx L353-439 (current — unconditional stack)
{tab === "video" ? (
  <div className="grid gap-5">
    <div className="lesson-modal-video">{/* status banner, unchanged */}</div>
    <div className="grid gap-3 md:grid-cols-2">
      {/* Upload lesson video / Upload live recording choice buttons — always visible today */}
    </div>
    <LessonUploadForm ... />
    <label className="lesson-modal-field">
      <span>YouTube or Vimeo URL</span>
      <input value={lesson.externalUrl ?? ""} onChange={...} />
    </label>
    <div className="lesson-modal-inline-status">{/* embed-detected status */}</div>
    <LessonAssetList assets={videoAssets} ... />
  </div>
) : null}
```
The new picker replaces the implicit "both always shown" model: wrap the upload-choice-buttons+form+asset-list block and the URL-field+status block each in a conditional on `resolvedSource`, and add the new 2-way source toggle above both.

### Current hardcoded precedence to replace (VID-05)
```tsx
// Source: src/components/learn/enrolled-course-workspace.tsx L1320-1331 (current)
{locked ? (
  <div className="member-video-empty">...</div>
) : primaryHostedVideo?.bunnyVideoId ? (
  <BunnyVideoPlayer assetId={primaryHostedVideo.id} title={lesson.title} />
) : primaryHostedVideo ? (
  <ProtectedAssetPreview asset={primaryHostedVideo} />
) : trustedEmbed ? (
  <iframe src={trustedEmbed.embedUrl} ... />
) : ( /* empty states */ )}
```
`BunnyVideoPlayer`/`ProtectedAssetPreview`/the `<iframe>` themselves need zero changes (VID-04 lock) — only which branch gets *entered* changes, driven by `lesson.videoSource ?? inferLessonVideoSource(...)` instead of by which value happens to be truthy.

## State of the Art

Not applicable in the usual sense (no external library version drift to track). The one relevant "old approach → current approach" is internal to this codebase:

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Firebase Firestore + Cloud Functions v2 for course docs and gated lesson content | Supabase Postgres (RLS + SECURITY DEFINER RPCs) + realtime `postgres_changes` | ~2026-06-30 (`docs/plans/2026-06-30-firebase-cutover-map.md`) | Comments in `teacher-course.ts`/`course-builder-studio.tsx` and `docs/technical/architecture.md` still describe the old model (see Pitfall 2). Functionally irrelevant to this phase, but a documentation trap. |

**Deprecated/outdated:** `docs/technical/architecture.md` L19 ("Backend functions: Firebase Cloud Functions v2") is stale and should ideally be corrected, though that's outside this phase's scope.

## Open Questions

1. **Does `update_teacher_course_builder` pass `modules[].videoSource` straight through, or does it reconstruct/allowlist lesson fields server-side?**
   - What we know: The function already re-derives some *course-level* fields server-side (title_key, lesson_count, platform_fee_bps — per the comment in `teacher-courses.ts` L55-59) rather than trusting the client blindly. Its SQL is not in this repo.
   - What's unclear: Whether that same "don't trust the client" treatment extends into the `modules` JSONB at the lesson level (in which case a brand-new lesson key like `videoSource` could be stripped even though the client sends it correctly).
   - Recommendation: Before or during plan execution, run `select pg_get_functiondef(oid) from pg_proc where proname = 'update_teacher_course_builder'` via Supabase MCP (or `supabase db pull` if CLI access to the linked project is available) and read the `modules` handling. If it does a blind JSONB assignment (e.g. `modules = p_payload->'modules'`), no RPC change is needed. If it reconstructs each lesson field-by-field, a new migration (mirroring the style of `20260704_add_bunny_video_id.sql` / `20260704_tighten_content_access_and_rpc_grants.sql` — SQL applied live via Supabase MCP, then copied into `supabase/migrations/` for versioning) is a required task, not optional polish.

2. **Should `getAssetStatusLabel()` in `lesson-content-modal.tsx` (L82-96, currently infers "Uploaded"/"Embedded"/"Empty" for the tab badge) switch to reading `videoSource` directly once it exists, or keep inferring?**
   - What we know: It's a small, isolated helper only used for the tab badge text; not part of the field-survival chain.
   - What's unclear: Whether showing the *explicit* choice (even for a lesson that has, say, an orphaned asset but `videoSource: "youtube"`) is more honest UX than showing what's technically present.
   - Recommendation: Claude's Discretion per CONTEXT.md; smallest-diff option is to leave it inference-based (cosmetic only) unless the plan wants the badge to reflect the picker's own state.

## Environment Availability

Skipped — this phase has no new external dependency. YouTube/Vimeo embedding, Bunny Stream, and Supabase Storage are all pre-existing integrations that this phase explicitly does not modify (VID-03, VID-04 locked decisions). The only genuinely new dependency to verify is *internal*: confirming the live Supabase RPC behavior (see Open Questions #1 and Risks #1) — that's a data/schema verification task, not a missing tool.

## Design Implementation Surface (VID-07)

**File:** `src/app/globals.css`. All lesson-modal styling lives in one contiguous block, roughly L2965-3560, class-prefixed `.lesson-modal*`.

### What already matches the spec (reuse directly)
- Root radius tokens already exist at the exact values the spec calls for: `--radius-xs: 6px` (root `:root` block, L61) and `--radius-sm: 8px` (L57). Use `var(--radius-xs)` for the solid/primary picker button and `var(--radius-sm)` for card/surface elements — do not hardcode `6px`/`8px` literals.
- Lucide icons are already the icon system in use in this exact file (`Film`, `UploadCloud`, `Link2`, `FileText`, `Settings`, `X`, `CheckCircle2`, `ImageIcon` all already imported in `lesson-content-modal.tsx`) — no new icon package needed, matches "line-icons sóbrios (Lucide, que já usamos)" from the source spec doc.

### What does NOT match and must not be reused unmodified
- `.lesson-modal-choice` (globals.css L3138-3171) — the existing 2-up radio-card pattern used for "Upload video / Upload live recording" — has `border-radius: 14px` (not 6-8px) and an active/hover border of `rgba(178, 34, 52, 0.35)` (crimson `--color-primary`, not Ink Indigo/Brass). Reuse the *interaction pattern* (grid of buttons + `is-active` class), not this CSS block verbatim.
- `.lesson-modal-video` (globals.css L3096-3136, the status banner at the top of the tab) uses a `--color-primary-dark`/`--color-primary` gradient — same old-skin issue, but this banner is out of scope (VID-07 only requires the picker itself to carry the new anatomy, not the whole tab).
- **Ink Indigo (`#14182B`) and Muted Brass (`#C6A15B`) do not exist as CSS variables anywhere in this codebase today.** The only occurrence of either hex value in the whole `src/` tree is a single hardcoded `color: #c6a15b` on `.logo-wordmark__accent` (globals.css L241-245, for the "Mind" half of the wordmark). There is no shared token to import — new ones must be introduced.

### Scope boundary — do not trigger a global reskin
The DESIGN-CLONE-SPEC source document itself (`PS8-OS\03-projetos\skillsetmind\DESIGN-CLONE-SPEC-HOTMART-2026-07-14.md`, §7) scopes the **full** Cosmos→SkillsetMind reskin (rail nav, card grids, global button anatomy) to "a passada de design que acompanha a sessão de código nº 2 (catálogo + sidebar religada)" — which in this project's `.planning/ROADMAP.md` is **Phase 3 (Núcleo do relançamento)**, not this phase. VID-07's requirement is narrower: only the new Video-tab source picker needs the new anatomy/palette. Recommended approach: introduce two new, additive CSS custom properties scoped to the new component (e.g. `--color-ink-indigo: #14182B; --color-brass: #C6A15B;` either globally additive in `:root` — safe, since nothing currently reads them — or scoped to a new `.lesson-video-source-picker` class) rather than repointing `--color-primary`/`--color-accent`, which are consumed in hundreds of places across the still-crimson app shell and are explicitly Phase 3's job.

### Anatomy targets (from the spec doc, already vault-verified against real measured values)
| Element | Height | Radius | Font weight |
|---|---|---|---|
| Solid/primary picker button | 40px | 6px (`--radius-xs`) | 400 (not bold) |
| Card/surface picker button | 44px | 8px (`--radius-sm`) | 400 idle, 700 active |
| Headings inside the picker | — | — | 600-700 ("headings pesados" — heavier than the Hotmart source's fw 400) |

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest 3.2.6 (+ `@testing-library/react` for component tests) |
| Config file | `vitest.config.ts` / `vitest.setup.ts` |
| Quick run command | `npx vitest run src/domain/teacher-course.test.tsx` (swap path per file) |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| VID-01 | `videoSource` survives `normalizeTeacherCourseModules()` | unit | `npx vitest run src/domain/teacher-course.test.tsx` | ✅ (extend existing file/test case) |
| VID-02 | Picker shows only the active source's input; switching preserves the other's data | component (RTL) | `npx vitest run src/components/teacher/lesson-content-modal.test.tsx` (or a dedicated picker sub-component test) | ❌ Wave 0 — no test file exists for this component today; recommend extracting a dependency-free `LessonVideoSourcePicker` so it can be tested the same lightweight way as `members-area-hero.test.tsx` (no Supabase mocking needed) |
| VID-03 | YouTube URL → `youtube-nocookie` embed | unit | `npx vitest run src/domain/lesson-embed.test.tsx` | ✅ (already covers this, no new test needed — reuse only) |
| VID-04 | Upload stays on existing Bunny/Supabase pipeline | manual/out-of-scope | — | N/A — locked as untouched, existing coverage (if any) is unaffected |
| VID-05 | Player renders per explicit `videoSource`, ignoring orphaned data | unit (recommended: extract the precedence decision into a small pure function, test it directly instead of only via component render) | `npx vitest run src/domain/teacher-course.test.tsx` (if colocated with the inference fn) or a new focused test file | ❌ Wave 0 — depends on how the precedence logic is extracted; smallest-diff plan should decide file location as part of Task 1 |
| VID-06 | Legacy lesson without `videoSource` infers correctly (asset→upload, else embed→youtube, else null) | unit | `npx vitest run src/domain/teacher-course.test.tsx` | ❌ Wave 0 — new function + new test cases, colocate in existing file |
| VID-07 | Video tab picker matches DESIGN-CLONE-SPEC anatomy/palette | manual/visual — no visual-regression tooling exists in this repo | — (manual review against the anatomy table above) | N/A — justified manual-only; asserting exact pixel radius/color via vitest+jsdom would test implementation detail, not the visual outcome |

### Sampling Rate
- **Per task commit:** run the specific domain test file touched (`npx vitest run src/domain/teacher-course.test.tsx`), plus any new component test file.
- **Per wave merge:** `npm test` (full suite) — cheap enough here (small, fast domain-heavy suite) to run every merge, no need for a slower "full" tier.
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus one manual pass through the anatomy table for VID-07.

### Wave 0 Gaps
- [ ] `src/components/teacher/lesson-content-modal.test.tsx` (or a new sub-component + its test) — covers VID-02. No test infra gap (vitest+RTL already proven on `members-area-hero.test.tsx`) — the gap is just that the file doesn't exist yet, and that `lesson-content-modal.tsx` as a whole currently pulls in `getSupabaseBrowserClient()` transitively (via `subscribeToCourseAssets`), so testing it directly needs either mocking `@/lib/supabase/client` or extracting a presentational picker sub-component with no data dependency (recommended — matches the existing lightweight test pattern).
- [ ] New test cases for `inferLessonVideoSource()` (VID-06) and the videoSource pass-through in `normalizeTeacherCourseModules()` (VID-01) — both colocate cleanly into the existing `src/domain/teacher-course.test.tsx`, no new file/framework needed.

*No framework installation gap — vitest, `@testing-library/react`, and the colocated-test convention are already fully established in this repo.*

## Sources

### Primary (HIGH confidence — read directly from this repo)
- `src/domain/teacher-course.ts` (full file) — `TeacherLesson`, `TeacherCourseModule`, `normalizeTeacherCourseModules()`
- `src/domain/learning.ts` (full file) — student-facing `Lesson`/`Course` types
- `src/domain/lesson-embed.ts` (full file) — `getTrustedLessonEmbed()`
- `src/domain/course-asset.ts` (full file) — `CourseAsset`, `canViewCourseAssetVideo()`
- `src/lib/data/teacher-courses.ts` (full file) — `updateTeacherCourseBuilder()` RPC call, other course RPCs
- `src/lib/data/published-courses.ts` (full file) — `rowToTeacherCourse()`, `teacherCourseToLearningCourse()`
- `src/lib/data/lesson-content.ts` (full file) — gated `course_lesson_content` table access
- `src/components/teacher/lesson-content-modal.tsx` (full file) — current Video tab UI
- `src/components/teacher/course-builder-studio.tsx` (relevant sections) — `updateLesson()`, `sanitizeModules()`, `buildBuilderDraftPayload()`, new-lesson creation
- `src/components/learn/enrolled-course-workspace.tsx` (relevant sections) — `LessonContentPanel()`, `resolvedSelectedLesson`, `selectedLessonAssets`
- `src/components/courses/creator-course-detail.tsx` (relevant sections) — public preview embed usage
- `src/app/globals.css` (`:root` tokens + `.lesson-modal*` block) — current design tokens and Video tab CSS
- `src/lib/supabase/database.types.ts` (`courses`, `course_lesson_content` table types)
- `supabase/migrations/*.sql` (all 7 files) — confirms migration-tracking start date and RPC-grant hardening
- `src/domain/teacher-course.test.tsx`, `src/domain/lesson-embed.test.tsx`, `src/components/learn/members-area-hero.test.tsx` — test convention confirmation
- `docs/technical/data-model.md`, `docs/technical/architecture.md` — doc-debt confirmation (stale Firebase reference)
- `package.json` — vitest version, test scripts
- `.planning/phases/01-video-hibrido/01-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/config.json`

### Secondary (HIGH confidence — read directly, external to repo but user-owned/authoritative for this project)
- `PS8-OS\03-projetos\skillsetmind\DESIGN-CLONE-SPEC-HOTMART-2026-07-14.md` — source of the design anatomy/palette requirements and its own explicit phase-scoping note

## Metadata

**Confidence breakdown:**
- Field survival chain (write path): HIGH — every file read directly, line numbers verified, except the RPC body (LOW, flagged explicitly)
- Field survival chain (read path): HIGH — every file read directly
- Architecture/design: HIGH — CSS and component structure read directly, cross-checked against the source design spec doc
- Pitfalls: HIGH — each pitfall traced to a specific line/comment in the repo

**Research date:** 2026-07-15
**Valid until:** ~14 days (internal-codebase research; stays valid until someone else edits these exact files/RPC, whichever is sooner — re-verify the RPC body regardless of date, since that's the one item this research could not confirm statically)


---

## ADDENDUM (orchestrator, 2026-07-15) — Open Question #1 RESOLVED via live DB

`pg_get_functiondef('update_teacher_course_builder')` executado no projeto Supabase `ijtikldtjvsbtwszokvs`:

- **`modules` é pass-through cego:** `v_modules := coalesce(p_payload->'modules', '[]'::jsonb)` → validações apenas estruturais (é array; conta lições; free-preview id deve existir) → `update public.courses set modules = v_modules`. **Nenhum allowlist de campos de lição server-side.** `videoSource` dentro de cada objeto de lição persiste SEM migração e SEM mudança na RPC.
- **Mirror gated confirmado:** a própria RPC upserta `course_lesson_content (lesson_id, course_id, content_text, external_url)` a partir de `v_modules` e deleta órfãos. `videoSource` NÃO precisa entrar nessa tabela (flag de roteamento, não conteúdo pago) — conclusão da pesquisa mantida.
- Consequência para o plano: os únicos pontos de sobrevivência do campo são os já mapeados no client: `normalizeTeacherCourseModules()` (write) e o allowlist per-lesson de `teacherCourseToLearningCourse()` em `published-courses.ts` (read), mais os types (`TeacherLesson`, `Lesson`) e consumidores (player, preview do criador, modal).
- Confiança da cadeia server-side: **HIGH** (antes LOW).
