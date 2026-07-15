---
phase: 01-video-hibrido
verified: 2026-07-15T06:00:00Z
status: human_needed
score: 7/7 must-haves verified
re_verification:
  previous_status: human_needed
  previous_score: 6/7
  gaps_closed:
    - "VID-07 visual anatomy verified from retained desktop and mobile captures"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Authenticated hybrid-video runtime flow"
    expected: "A saved YouTube-source lesson plays through youtube-nocookie even with an uploaded asset; switching to upload plays Bunny or Supabase without deleting either source; an untouched legacy lesson keeps its prior playback."
    why_human: "Requires an authenticated teacher/student course, persisted production-shaped data, and configured Bunny/Supabase services."
---

# Phase 1: Video Hibrido Verification Report

**Phase Goal:** Criador escolhe explicitamente, por aula, entre YouTube embed e upload nativo; o player respeita a escolha; licoes existentes continuam funcionando sem migracao manual.
**Verified:** 2026-07-15T06:00:00Z
**Status:** human_needed
**Re-verification:** Yes - visual-evidence gap only

## Verdict

All VID-01 through VID-07 requirements are now verified. The retained desktop and mobile captures close the prior VID-07 evidence gap and agree with the scoped CSS contract. The phase verdict remains **human_needed** only because authenticated playback against Bunny/Supabase and persisted production-shaped switching data still require a runtime check.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | VID-01: `videoSource` is explicit and persists through the course write/read path | VERIFIED | `TeacherLesson.videoSource` exists; `normalizeTeacherCourseModules` preserves only `youtube`/`upload`; `updateTeacherCourseBuilder` sends normalized modules in `p_payload`; `rowToTeacherCourse` reads modules as opaque JSONB; `teacherCourseToLearningCourse` copies `videoSource`. The research addendum records live RPC pass-through as `v_modules := coalesce(p_payload->'modules', '[]'::jsonb)` then `modules = v_modules`. |
| 2 | VID-02: the Video tab offers YouTube/Upload and shows only the active source UI | VERIFIED | `LessonVideoSourcePicker` renders exactly two controlled options. `lesson-content-modal.tsx` renders upload UI only for `resolvedSource === "upload"`, URL/status only for `"youtube"`, and only helper text for `null`. Picker tests pass. |
| 3 | VID-03: external embeds pass through the trusted normalization gate | VERIFIED | Modal and classroom both call `getTrustedLessonEmbed`; the parser accepts YouTube watch, youtu.be, embed, shorts, and live paths, emits `https://www.youtube-nocookie.com/embed/{id}`, supports Vimeo, and rejects untrusted hosts/protocols. Existing embed tests pass; `/live/` is confirmed statically but lacks its own test case. |
| 4 | VID-04: native upload remains behind the Bunny/Supabase protected abstraction | VERIFIED | Phase diff is clean for `course-assets.ts`, Bunny config/server helpers, upload-creation route, video-token route, and `course-asset.ts`. The modal selects Bunny TUS when configured and Supabase Storage otherwise. The Bunny upload route requires authentication and course ownership; playback token minting requires authentication plus preview/owner/enrollment/admin entitlement. Real service playback still needs human verification. |
| 5 | VID-05: explicit source wins and switching is non-destructive | VERIFIED | Classroom resolves `lesson.videoSource ?? inferLessonVideoSource(...)` once, then gates Bunny/protected asset playback on `upload` and trusted iframe playback on `youtube`. The modal switch calls only `onUpdateLesson({ videoSource })`; the studio merges the partial patch, so `externalUrl` and asset rows are untouched. Creator preview suppresses an embed for explicit upload lessons. |
| 6 | VID-06: legacy lessons infer upload first, then trusted embed, then no source | VERIFIED | Pure inference function and tests cover all three branches. Both modal and classroom invoke inference only when `videoSource` is null/absent, preserving legacy asset-first behavior without persisting a guess. |
| 7 | VID-07: picker visually matches the scoped Ink Indigo/Brass contract | VERIFIED | Retained `evidence/video-source-picker-desktop.png` and `evidence/video-source-picker-mobile.png` show the real component and stylesheet in YouTube-active, Upload-active, and null states. Desktop uses a clean two-column layout; mobile stacks without picker-content collisions. Brass active borders/inset accents, Ink Indigo copy, heavy headings, rounded cards, source-specific content, and the null-state helper are visible. Static CSS confirms 44px minimum height, 8px radius, and scoped additive tokens. |

**Score:** 7/7 requirement-level truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/domain/teacher-course.ts` | Explicit field, strict normalization, legacy inference | VERIFIED | Exists, substantive, exported inference is used by modal and player. |
| `src/domain/learning.ts` | Student-facing source field | VERIFIED | Uses shared `LessonVideoSource` type. |
| `src/lib/data/published-courses.ts` | Read-path allowlist mapping | VERIFIED | Maps `videoSource: lesson.videoSource ?? null`. |
| `src/components/learn/enrolled-course-workspace.tsx` | Explicit classroom routing | VERIFIED | Source controls mutually exclusive hosted/embed branches; existing protected players remain wired. |
| `src/components/courses/creator-course-detail.tsx` | Public-preview source gate | VERIFIED | Explicit upload produces no stale external embed. |
| `src/components/teacher/lesson-video-source-picker.tsx` | Controlled two-option picker | VERIFIED | 62 lines, imported and rendered by the lesson modal; no data-service dependency. |
| `src/components/teacher/lesson-content-modal.tsx` | Inference, picker wiring, source-gated inputs | VERIFIED | Real course assets and lesson URL feed source resolution; switching patches only the source. |
| `src/domain/lesson-embed.ts` | Trusted URL parser/normalizer | VERIFIED | Only trusted YouTube/Vimeo forms become iframe URLs. |
| `src/app/globals.css` | Scoped VID-07 design island | VERIFIED | CSS contract is wired and its desktop/mobile rendering is retained in both evidence captures. |
| Protected upload/playback files | Existing Bunny/Supabase and entitlement boundary | VERIFIED | Substantive and unchanged throughout Phase 1. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| Picker | Builder lesson state | `onUpdateLesson({ videoSource })` to generic partial merge | WIRED | Patch preserves every inactive-source field and all asset rows. |
| Builder state | Postgres modules JSONB | shared draft payload to `updateTeacherCourseBuilder` RPC | WIRED WITH EXTERNAL EVIDENCE | Client path is verified. Live RPC pass-through is recorded in the research addendum but its body is not versioned locally and was not re-queried during this verification. |
| Postgres lesson JSONB | Student lesson | `rowToTeacherCourse` then `teacherCourseToLearningCourse` | WIRED | Opaque read followed by explicit `videoSource` mapping. |
| Student lesson | Playback branch | explicit source or legacy inference | WIRED | Explicit choice always wins over orphaned alternate media. |
| YouTube branch | Trusted iframe | `getTrustedLessonEmbed` | WIRED | Response is consumed as `trustedEmbed.embedUrl`; no raw lesson URL is used as iframe `src`. |
| Upload branch | Protected playback | `BunnyVideoPlayer` or `ProtectedAssetPreview` | WIRED | Bunny fetches the protected token route; Supabase path requests a signed private-object URL. |
| Upload UI | Storage abstraction | Bunny TUS when configured, Supabase otherwise | WIRED | Existing implementation is reached only from the upload branch and was not rewritten. |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
| --- | --- | --- | --- | --- |
| Lesson modal | `resolvedSource` | Persisted lesson field plus subscribed course assets and trusted external URL | Yes | FLOWING |
| Course save | `modules[].videoSource` | Builder state, normalized into RPC JSON payload | Yes; server pass-through supported by recorded live SQL evidence | FLOWING WITH EXTERNAL-DRIFT RISK |
| Classroom | `resolvedVideoSource` | Published-course mapper plus real course assets and gated lesson content | Yes | FLOWING |
| YouTube iframe | `trustedEmbed.embedUrl` | Trusted URL parser | Yes | FLOWING |
| Hosted video | `primaryHostedVideo` | Real `course_assets` rows | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command/evidence | Result | Status |
| --- | --- | --- | --- |
| Source normalization and legacy inference | Focused Vitest run: `src/domain/teacher-course.test.tsx` | 12 tests passed | PASS |
| Trusted YouTube/Vimeo parsing and rejection | Focused Vitest run: `src/domain/lesson-embed.test.tsx` | 3 tests passed | PASS |
| Picker options, state, changes, and disabled behavior | Focused Vitest run: `src/components/teacher/lesson-video-source-picker.test.tsx` | 4 tests passed | PASS |
| Combined focused gate | Three files above | 3 files, 19/19 tests passed | PASS |
| VID-07 desktop rendering | `evidence/video-source-picker-desktop.png` | Two-column YouTube-active, Upload-active, and null states render cleanly with scoped Brass/Ink treatment | PASS |
| VID-07 mobile rendering | `evidence/video-source-picker-mobile.png` | Options stack responsively; active states, source-specific content, and null state remain legible | PASS |
| Full lint/typecheck/test/build gate | Plan 01-04 summary reports lint, typecheck, 168 tests, and 96-page build | Not independently completed in this verification after the user requested long checks stop | NOT RE-RUN |
| Authenticated end-to-end media playback | Requires running app and external services | No independent runtime evidence | NEEDS HUMAN |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| --- | --- | --- | --- |
| VID-01 | 01-01 | SATISFIED | Domain field, normalization, RPC payload, opaque JSONB read, and student mapping are connected. |
| VID-02 | 01-03 | SATISFIED | Controlled two-option picker and mutually exclusive source branches are wired in the real lesson modal. |
| VID-03 | 01-03 | SATISFIED | Existing trusted embed gate remains the sole iframe source normalizer. |
| VID-04 | 01-03, 01-04 | SATISFIED STATICALLY | Protected Bunny/Supabase boundary is substantive and phase-diff clean; runtime credentials remain untested. |
| VID-05 | 01-02 | SATISFIED | Explicit source gates classroom and creator-preview behavior; no alternate-media fallback overrides it. |
| VID-06 | 01-01 | SATISFIED | Upload-first legacy inference is tested and shared by modal/classroom. |
| VID-07 | 01-03, 01-04 | SATISFIED | Static CSS contract plus retained desktop/mobile captures verify responsive anatomy, active styling, and all picker states. |

No orphaned Phase 1 requirements were found: ROADMAP, REQUIREMENTS, and plan frontmatter all map exactly VID-01 through VID-07.

### Anti-Patterns Found

No blocker or warning anti-pattern was found in the phase implementation. Grep matches for `return null` are legitimate normalization/inference/guard paths, and `Preview coming soon` is unrelated catalog fallback copy. `git diff --check` reported no whitespace errors.

## Assessment of the Plan 01-04 QA Substitution

The substitution is now **sufficient for VID-07**. Both referenced captures exist and are inspectable:

- desktop evidence shows two-column source cards across YouTube-active, Upload-active, and null states;
- mobile evidence shows the same states stacked responsively with legible labels and descriptions;
- the active Brass border/inset accent, Ink Indigo text, heavy heading/active label, rounded anatomy, URL branch, upload branch indicator, and null helper all render as intended;
- static diff evidence still establishes that the palette/radius changes are scoped rather than a global token repointing.

The capture route is isolated and therefore does not prove authenticated persistence or external playback, but those are separate from VID-07. A floating consent/widget control touches the bottom null-helper area in the mobile image; it does not obscure either source option and is not emitted by the picker component, so it is recorded as a minor integration risk rather than a VID-07 failure.

## Human Verification Required

### 1. Authenticated hybrid-video flow

**Test:** In a teacher course containing both an external URL and hosted video, save `youtube`, verify student `youtube-nocookie` playback, switch to `upload`, reload, and verify Bunny/Supabase playback; then switch back and confirm both sources remain. Also open an untouched legacy lesson.
**Expected:** Explicit choice controls playback after save/reload; neither switch deletes URL/assets; legacy behavior remains asset-first then trusted embed.
**Why human:** Requires authenticated persisted data and configured external media services.

## Residual Risks

- The live `update_teacher_course_builder` body is not versioned in this repository. The research addendum gives precise pass-through evidence, but future live-database drift would not be caught by source review.
- There is no dedicated component/integration test exercising the classroom's explicit-source precedence with both asset and embed present; current confidence comes from direct control-flow inspection.
- The `/live/` YouTube form is implemented in the parser but is not asserted in the existing embed test.
- Bunny, Supabase Storage, RLS, signed-token playback, and the actual authenticated modal were not exercised during this verification.
- The mobile evidence contains a floating consent/widget button touching the lower null-state helper at the viewport edge. It does not affect the source options, but the authenticated shell should confirm overlay positioning.

## Gaps Summary

No code or VID-07 evidence gap remains. All 7 requirement-level truths are verified. The sole remaining human checkpoint is authenticated external-service playback/persistence; once it passes, the phase can be marked `passed` without further implementation changes.

---

_Re-verified: 2026-07-15T06:00:00Z_
_Verifier: Codex (gsd-verifier)_
