---
phase: 01-video-hibrido
plan: 02
subsystem: learning-ui
tags: [typescript, react, video-playback, course-preview]

requires:
  - phase: 01-video-hibrido-01
    provides: Explicit typed lesson videoSource, legacy inference, and student-facing mapping
provides:
  - Student playback routed by explicit lesson videoSource with legacy inference fallback
  - Creator public preview embeds suppressed for upload-source lessons
affects: [01-03-source-picker, 01-04-verification]

tech-stack:
  added: []
  patterns:
    - Persisted media-source choice controls player routing independently of orphaned media
    - Legacy-only inference preserves upload-first behavior when videoSource is absent

key-files:
  created: []
  modified:
    - src/components/learn/enrolled-course-workspace.tsx
    - src/components/courses/creator-course-detail.tsx

key-decisions:
  - "Explicit videoSource always wins; inferLessonVideoSource is consulted only when the field is absent."
  - "The asset-blind public preview suppresses embeds for upload lessons without adding asset playback or storage access."

patterns-established:
  - "Playback routing: resolve source once, then gate each existing player branch on that source."
  - "Preview routing: explicit upload returns no embed while youtube and legacy lessons retain trusted-embed behavior."

requirements-completed: [VID-05]

duration: 16 min
completed: 2026-07-15
---

# Phase 1 Plan 02: Explicit Video Playback Routing Summary

**Student and creator-preview playback now obey explicit lesson video sources while legacy lessons retain upload-first inference**

## Performance

- **Duration:** 16 min
- **Started:** 2026-07-15T05:14:37Z
- **Completed:** 2026-07-15T05:30:27Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Replaced asset-presence precedence in `LessonContentPanel` with one resolved source that honors an explicit creator choice.
- Preserved legacy playback by invoking `inferLessonVideoSource` only when `lesson.videoSource` is absent.
- Prevented upload-source lessons from rendering a stale trusted embed in the creator public preview.
- Kept Bunny playback, protected asset preview, storage, token, and entitlement internals unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Player respects explicit lesson videoSource** - `44682fe` (feat)
2. **Task 2: Public preview respects lesson videoSource** - `8d3cbf1` (feat)

**Plan metadata:** committed separately with this summary.

## Files Created/Modified

- `src/components/learn/enrolled-course-workspace.tsx` - Resolves explicit-or-inferred video source once and gates the existing hosted/embed branches accordingly.
- `src/components/courses/creator-course-detail.tsx` - Returns no trusted embed for an explicit upload-source preview lesson.

## Decisions Made

- Kept the lock check first and left all player components and iframe attributes intact; only branch eligibility changed.
- Allowed an upload-source public preview to use its existing non-embed fallback because this component intentionally has no course-asset data source.
- Preserved YouTube/Vimeo validation through `getTrustedLessonEmbed` as the only embed gate.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Windows PowerShell 5 rejected the plan's `&&` syntax, so the exact chained verification commands were run through `cmd.exe`.
- A concurrent Wave 2 RED commit briefly left a picker test importing a component that had not yet been written. No concurrent files were touched; verification was rerun successfully after the other executor added the component.
- The repository post-commit hook emitted the previously documented `npm error could not determine executable to run` after each successful `--no-verify` commit. Both commits were created correctly.
- The generated graph was queried before source inspection. Its post-edit refresh is deferred to the orchestrator because `graphify-out/` is outside this executor's exclusive write scope during the shared wave.

## Known Stubs

None. The scan found only pre-existing input placeholder usage and checkout-unavailable fallback copy; neither is a data stub or part of this plan's media routing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Playback behavior is ready for Wave 2 reconciliation with the parallel source-picker plan.
- VID-04 boundaries remain intact, and Plan 01-04 can verify the complete explicit-choice flow after the orchestrator updates shared planning state.

## Self-Check: PASSED

- Both scoped source files and this summary exist.
- Task commits `44682fe` and `8d3cbf1` are present in repository history.
- Required typecheck, lint, tests, grep guards, and VID-04 diff checks passed.

---
*Phase: 01-video-hibrido*
*Completed: 2026-07-15*
