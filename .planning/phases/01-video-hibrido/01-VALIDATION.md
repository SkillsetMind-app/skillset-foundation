---
phase: 1
slug: video-hibrido
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-15
---

# Phase 1 - Validation Strategy

> Per-phase validation contract for the explicit hybrid-video source flow.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.2.6 with React Testing Library |
| **Config file** | `vitest.config.ts` and `vitest.setup.ts` |
| **Quick run command** | `npx vitest run <changed-test-file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | Less than 60 seconds for the full local suite |

---

## Sampling Rate

- **After every task commit:** Run the focused test file for the changed behavior.
- **After every plan wave:** Run `npm test`.
- **Before phase verification:** Run `npm run lint && npx tsc --noEmit && npm test`.
- **Maximum feedback latency:** One task; no three consecutive tasks lack an automated check.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01-01 | 1 | VID-01, VID-06 | Unit | `npx vitest run src/domain/teacher-course.test.tsx` | Yes, extended | Passed |
| 01-01-02 | 01-01 | 1 | VID-01 | Type and integration | `npx tsc --noEmit && npm run lint && npm test` | Yes | Passed |
| 01-02-01 | 01-02 | 2 | VID-05, VID-06 | Unit and integration | `npx tsc --noEmit && npm test` | Yes | Passed |
| 01-02-02 | 01-02 | 2 | VID-05 | Type, lint, integration | `npx tsc --noEmit && npm run lint && npm test` | Yes | Passed |
| 01-03-01 | 01-03 | 2 | VID-02 | Component | `npx vitest run src/components/teacher/lesson-video-source-picker.test.tsx` | Yes, created by task | Passed |
| 01-03-02 | 01-03 | 2 | VID-07 | Static CSS gate | `npm run lint` plus token/class inspection | Yes | Passed |
| 01-03-03 | 01-03 | 2 | VID-02, VID-03, VID-04 | Type, lint, integration | `npx tsc --noEmit && npm run lint && npm test` | Yes | Passed |
| 01-04-01 | 01-04 | 3 | VID-01 through VID-07 | Full automated gate | `npm run lint && npx tsc --noEmit && npm test` | Yes | Passed |
| 01-04-02 | 01-04 | 3 | VID-04, VID-05, VID-07 | Visual and boundary verification | Responsive captures plus diff audit | Yes | Passed with documented runtime substitution |

---

## Wave 0 Requirements

- [x] Add `videoSource` pass-through and inference cases to `src/domain/teacher-course.test.tsx` in plan 01-01.
- [x] Create `src/components/teacher/lesson-video-source-picker.test.tsx` before the picker implementation in plan 01-03.
- [x] Keep existing `src/domain/lesson-embed.test.tsx` as the authoritative YouTube normalization gate for VID-03.

No test framework or shared fixture installation is required.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Source picker anatomy and scoped Ink Indigo/Brass styling | VID-07 | No visual-regression tooling exists | Inspect the Video tab at desktop and mobile sizes against the 44 px, 8 px, 40 px, 6 px, Ink Indigo, and Brass contract. |
| Hosted video remains on the current Bunny or Supabase pipeline | VID-04 | Requires configured storage/runtime credentials | Play an upload-source lesson and confirm the existing signed hosted-video path is unchanged. |
| Explicit source wins without deleting the inactive source | VID-05 | Requires a saved course containing both URL and hosted asset | Switch between YouTube and Upload, reload, and confirm playback follows the choice while both source records remain. |
| Legacy lesson inference | VID-06 | Requires pre-phase persisted lesson data | Open an untouched lesson and confirm the modal and classroom infer the same source it used before the phase. |

---

## Validation Sign-Off

- [x] Every automated task has a focused or full-suite verification command.
- [x] Sampling continuity prevents three consecutive unverified tasks.
- [x] Wave 0 identifies every missing test artifact and assigns its creation to a TDD task.
- [x] No watch-mode command is used.
- [x] Manual-only checks are limited to visual/runtime behavior that cannot be proven in jsdom.
- [x] `nyquist_compliant: true` is set in frontmatter.

**Approval:** Approved 2026-07-15 after plan-checker review; execution results will update task statuses.
