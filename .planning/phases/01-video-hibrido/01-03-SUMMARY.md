---
phase: 01-video-hibrido
plan: 03
subsystem: teacher-ui
tags: [react, vitest, video-source, css]

requires:
  - phase: 01-video-hibrido
    provides: Typed lesson videoSource and upload-first legacy inference from plan 01
provides:
  - Accessible controlled YouTube-versus-upload lesson source picker
  - Source-gated lesson modal UI with non-destructive switching
  - Scoped Ink Indigo and Brass picker design island
affects: [01-04-verification, teacher-course-builder]

tech-stack:
  added: []
  patterns:
    - Dependency-free controlled UI components tested with RTL
    - Conditional source visibility without clearing inactive-source data

key-files:
  created:
    - src/components/teacher/lesson-video-source-picker.tsx
    - src/components/teacher/lesson-video-source-picker.test.tsx
  modified:
    - src/components/teacher/lesson-content-modal.tsx
    - src/app/globals.css

key-decisions:
  - "Legacy lessons resolve their picker value with inferLessonVideoSource without persisting the inferred choice."
  - "Source changes patch only videoSource; external URLs and uploaded assets remain intact."
  - "Ink Indigo and Brass are additive tokens consumed only by the new scoped picker island."

patterns-established:
  - "Source picker: controlled button cards expose aria-pressed and suppress redundant active-option changes."
  - "Media routing UI: render only the selected source branch while retaining both sources' stored data."

requirements-completed: [VID-02, VID-03, VID-04, VID-07]

duration: 17 min
completed: 2026-07-15
---

# Phase 1 Plan 03: Lesson Video Source Picker Summary

**Accessible YouTube/upload source cards with legacy inference, non-destructive modal gating, and a scoped Ink Indigo/Brass design island**

## Performance

- **Duration:** 17 min
- **Started:** 2026-07-15T05:14:08Z
- **Completed:** 2026-07-15T05:31:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added a dependency-free two-option source picker with active, empty, change, and disabled-state RTL coverage.
- Wired legacy inference and explicit source selection into the lesson modal so only the upload or trusted-embed branch renders.
- Preserved inactive-source data by limiting source switches to `onUpdateLesson({ videoSource })`.
- Added the new palette and 40-44px/6-8px anatomy as a scoped CSS island without changing existing global token values or modal styles.

## Task Commits

1. **Task 1 RED: picker behavior specification** - `91c48d4` (test)
2. **Task 1 GREEN: presentational picker component** - `baf0bd5` (feat)
3. **Task 2: scoped source-picker design island** - `20464f2` (feat)
4. **Task 3: lesson modal source routing** - `3e4d1b1` (feat)

**Plan metadata:** committed separately with this summary.

## Files Created/Modified

- `src/components/teacher/lesson-video-source-picker.tsx` - Controlled accessible source cards using Lucide icons.
- `src/components/teacher/lesson-video-source-picker.test.tsx` - Four RTL tests for options, state, changes, and disabled behavior.
- `src/components/teacher/lesson-content-modal.tsx` - Legacy source resolution plus mutually exclusive upload/embed branches.
- `src/app/globals.css` - Additive palette tokens and scoped picker anatomy.

## Decisions Made

- Kept the picker isolated from Supabase and upload services so it remains lightweight and directly testable.
- Used the existing domain inference function only when `lesson.videoSource` is absent; explicit choices always win.
- Left `getTrustedLessonEmbed()` unchanged as the sole external embed gate and left all upload pipeline/storage files untouched.

## Verification

- TDD RED: focused Vitest run failed because the picker module did not yet exist.
- TDD GREEN: focused Vitest run passed 4/4 picker tests.
- Task 2: `npm run lint` passed and the `color-ink-indigo` grep count was 6.
- Task 3: `npx tsc --noEmit && npm run lint && npm test` passed; Vitest reported 31 files and 168 tests passing.
- Static audit confirmed the picker has no `getSupabaseBrowserClient` import, the source switch has exactly one source-only patch, upload pipeline files are diff-clean, and the CSS task commit contains no removed lines.

## Deviations from Plan

None - plan executed exactly as written. The TDD task produced separate RED and GREEN commits as required by the execution workflow.

## Issues Encountered

- PowerShell 5 rejected the plan's `&&` syntax directly; the command was rerun successfully through Windows `cmd`.
- The repository post-commit hook emitted `npm error could not determine executable to run` after commits despite `--no-verify`; every commit was still created successfully and explicit verification passed.
- `graphify update .` was not run because it writes `graphify-out/`, outside this parallel executor's exclusive write scope. The required pre-inspection graph query/explain was completed.

## Known Stubs

None. Stub-pattern matches were existing input placeholder attributes, an existing explanatory comment, and the intentional `resolvedSource === null` empty-choice branch; no mock or empty data source was introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for plan 01-04 verification of the complete hybrid-video flow.
- No upload, token, entitlement, or storage pipeline file was changed by this plan.

## Self-Check: PASSED

- All four required source files exist.
- Commits `91c48d4`, `baf0bd5`, `20464f2`, and `3e4d1b1` exist in repository history.
- Summary claims match fresh test, lint, typecheck, diff, and static-audit output.

---
*Phase: 01-video-hibrido*
*Completed: 2026-07-15*
