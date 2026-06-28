# Members-area continuation (2026-06-28)

Handoff for the next session. Pairs with `members-area-implementation-brief.md` and
`docs/plans/2026-06-23-members-area-architecture.md`. Branch: `feat/niche-comms-and-design-alignment`.

## Context

The founder's Claude Design members area (`membros/` in design project
`f23171e7-26f7-4363-ba9b-a047dd4f2cb3`) is a visual target, not a greenfield port. A
parallel-reader workflow mapped the live `/learn` area against it and confirmed the
"augment, not rebuild" decision: about 70% of the design already ships. Shell, drawer nav,
CourseHome progress + Continue + mark-complete + the 100% "Get certificate" CTA,
CommunityView (composer, posts, likes, one-level replies, moderator pin), and CertificateView
(paper, 100% lock client and server, print-to-PDF) all exist.

## Done this session (committed, tsc-clean)

- Niche copy de-AI pass via the humanizer skill. Removed every em-dash and the AI-cadence
  from hero, how-it-works, capabilities, featured-courses, and footer. Commit `2eeee18`.
- Certificate "Add to LinkedIn" (LinkedIn Add-to-Profile certification deep link, built from
  the existing `verificationCode` + `SITE_URL` + `/verify?code=`) and PDF polish (button
  relabeled "Download PDF", `@media print` block for page margin and faithful brand colors).
  `certificate-print-view.tsx` + `globals.css`. Commit `0407057`.
- Verified the whole project with `node_modules/.bin/tsc --noEmit` (exit 0, zero errors).
  Note: `npx tsc` does not resolve in this repo; use the local binary directly.

## Confirmed already-built (no work needed)

- CourseHome "Get certificate" CTA at 100%: `enrolled-course-workspace.tsx:575-583` (and a
  second one in the sidebar at 696-697). The gap-map flagged this as missing; the code shows
  it exists. Verify before building.
- Assistant FAB = existing `HelpBubble` (`platform-shell.tsx:125`).
- Search Cmd-K = existing `PlatformSidebarSearch` (just mis-routes for learners, see below).
- Professor view-as-student = existing `course-preview-shell.tsx` preview mode.

## Remaining (do with a working preview, in this order)

These were left for a preview-enabled session because they are layout or data changes that
should be eyeballed, and this session could not run a dev server (the `:3000` instance is
owned by another OS session and could not be stopped).

1. [S] Modules grid/list toggle over the existing `member-module-deck`
   (`enrolled-course-workspace.tsx:706-851`). Pure layout state, reuse the existing lesson
   cards. The design's "grade | lista" switch.
2. [S] Search routes to lessons for learners: add a `/learn` branch to `submitSearch`
   (`platform-shell.tsx:177-183`); today the learner submit goes to `/courses?q=`. Decide the
   target surface (a lesson-aware result, or scope to the existing enrollment filter in
   `learn-dashboard.tsx:208-212`). Do not build a new global lesson index.
3. [S] Surface a visible "View as student" link from the teach builder to the existing
   `course-preview-shell.tsx`. No new mode.
4. [M] Video resume: extend the `recordLessonProgress` callable payload and
   `lib/data/lesson-progress.ts` with `lastPositionSeconds`; add a throttled `onTimeUpdate`
   (about every 10s) plus a mount-time seek in `watermarked-video-player.tsx`, wired through
   the viewer in `enrolled-course-workspace.tsx`; add the `firestore.rules` allow for the new
   field. The client cannot write progress directly (server-authoritative), so extend the
   callable, do not bypass it.
5. [M] Course-to-course upsell card. FOUNDER INPUT NEEDED: the open paywall leak means a new
   surface must not render paywalled lesson content. A pure course-to-course link is safe; a
   lesson preview is not. Smallest version: a dismissible completion card linking to one
   related published course, reusing `teacherCourseToCourseCard`
   (`published-courses.ts:88`) and the existing course-card UI. No offer/pricing abstraction.
6. [Phase 0, M] Notifications: this is a verify-and-deploy gap, not a build gap. The Phase-1
   notifications work was written but not committed/deployed; `NotificationBell`
   (`platform-header.tsx:64-65`) likely still shows a hardcoded `unreadCount=0`. Read the
   impl, finish and commit the in-flight work, confirm the unread dot is wired to real data.
   Do not build a new component.

## Out of scope (do not start)

- Quiz / assessment. Not in the design, excluded by the brief, no question/submission/grading
  model exists. It is a separate milestone.
- The design's "Tweaks" panel (theme/accent/font switches). It is design-tool scaffolding.
- Dark-mode polish. Not a stated design target.

## Hard constraints

- The HIGH paywall leak (world-readable lesson content) is still open. No new members surface
  may render or link to paywalled lesson content until that is fixed.
- The live app is English. The design's PT-BR copy is placeholder; do not ship it.
- Keep changes additive and reuse existing components (instructor-as-tenant, separate surfaces).
