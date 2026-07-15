---
phase: 01-video-hibrido
plan: 01
subsystem: domain-data
tags: [typescript, vitest, course-lessons, video]

requires: []
provides:
  - Explicit typed lesson videoSource persisted through module normalization
  - Upload-first legacy video-source inference
  - Student-facing videoSource mapping for published courses
affects: [01-02-player, 01-03-source-picker, 01-04-verification]

tech-stack:
  added: []
  patterns:
    - Strict literal normalization at the client JSONB write choke point
    - Pure legacy inference shared by downstream video consumers

key-files:
  created: []
  modified:
    - src/domain/teacher-course.ts
    - src/domain/teacher-course.test.tsx
    - src/domain/learning.ts
    - src/lib/data/published-courses.ts
    - docs/technical/data-model.md

key-decisions:
  - "Only exact youtube/upload literals survive normalization; absent or invalid values become null."
  - "Legacy inference prefers an uploaded video asset over a trusted embed."
  - "The student Lesson reuses the domain LessonVideoSource alias and receives null for an absent source."

patterns-established:
  - "Field survival: add lesson routing fields to both normalizeTeacherCourseModules and teacherCourseToLearningCourse."
  - "Legacy compatibility: infer source from asset/embed presence without inventing persisted state."

requirements-completed: [VID-01, VID-06]

duration: 7 min
completed: 2026-07-15
---

# Phase 1 Plan 01: Lesson Video Source Foundation Summary

**Typed lesson video-source persistence with strict normalization, upload-first legacy inference, and student-facing mapping**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-15T04:59:01Z
- **Completed:** 2026-07-15T05:06:27Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `videoSource` to teacher and student lesson models without a schema migration.
- Preserved valid sources through the write-path normalizer while coercing absent or invalid values to `null`.
- Added tested legacy inference: video asset → `upload`, otherwise trusted embed → `youtube`, otherwise `null`.
- Added `videoSource` to the published-course lesson allowlist so the student player can consume it.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: lesson video-source behavior tests** - `a25e017` (test)
2. **Task 1 GREEN: domain field, normalization, and inference** - `f52cfde` (feat)
3. **Task 2: student-facing lesson mapping and documentation** - `7efc639` (feat)

**Plan metadata:** committed with this summary.

## Files Created/Modified

- `src/domain/teacher-course.ts` - Adds `LessonVideoSource`, the lesson field, strict normalization, and legacy inference.
- `src/domain/teacher-course.test.tsx` - Covers exact field preservation, invalid/absent normalization, and all inference branches.
- `src/domain/learning.ts` - Exposes `videoSource` on the student-facing `Lesson`.
- `src/lib/data/published-courses.ts` - Copies `videoSource` through the explicit lesson allowlist.
- `docs/technical/data-model.md` - Documents the persisted lesson routing field.

## Decisions Made

- Reused a shared `LessonVideoSource` alias because `learning.ts` already imports teacher-course domain types.
- Kept inference pure and persistence-neutral: legacy detection returns a source but does not mutate the lesson.
- Relied on the research-confirmed blind JSONB RPC pass-through; no migration or RPC edit was needed.

## Deviations from Plan

None - plan executed exactly as written. The TDD task produced separate RED and GREEN commits as required by the execution workflow.

## Issues Encountered

- The pre-existing `mex` post-commit hook emitted `npm error could not determine executable to run` after each successful Git commit. Commits were created correctly, and the required explicit `graphify update .` completed successfully.

## Known Stubs

None. The pre-existing “Preview coming soon” strings in `published-courses.ts` are intentional catalog fallback copy and are unrelated to lesson video-source data wiring.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for `01-02-PLAN.md` to make student and creator-preview playback respect the explicit source.
- No blocker or migration dependency remains; both client-side field survival choke points are wired.

---
*Phase: 01-video-hibrido*
*Completed: 2026-07-15*
