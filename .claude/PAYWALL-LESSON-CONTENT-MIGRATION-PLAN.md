# #1 (HIGH) — Paywalled lesson content is world-readable — migration plan

> **Status:** DEFERRED for a supervised window (production data migration).
> **Why deferred:** the only correct fix moves lesson content into a new
> enrollment-gated subcollection and requires a destructive backfill of the
> live `courses` collection. A botched run breaks the core paid-content flow
> (learners lose access to content they purchased; teachers lose lesson bodies).
> That is a hard-to-reverse, outward-facing change that must not run
> unsupervised. **Do NOT commit this file to the public repo** — it describes an
> open vulnerability. Keep it local until the repo is private (task #19) or the
> leak is closed.

## The vulnerability

`courses/{courseId}` is publicly readable when `status in ['published','in_review']`
(`firestore.rules:1559`). Each course doc carries the FULL course inline,
including every lesson's gated payload:

- `modules[].lessons[].contentText` (up to 20 000 chars — the lesson body)
- `modules[].lessons[].externalUrl` (the video / resource link)

So anyone — unauthenticated — can read `courses/{id}` and harvest the entire
paid curriculum without enrolling. Client-side `locked` gating
(`enrolled-course-workspace.tsx:962`) only hides it visually; the DATA ships in
the public doc. Firestore has no field-level read rules, so the content MUST
move to a separately-gated document. Confirmed HIGH.

## Surfaces involved

| Surface | File | Note |
|---|---|---|
| Public read rule | `firestore.rules:1554-1635` (`match /courses/{courseId}`) | leak origin; has the `assets` + `lessonComments` subcollection precedent to copy |
| Enrollment gate | `firestore.rules:826` `hasEnrollmentForCourseSlug()` | reuse verbatim |
| Client write | `src/components/teacher/course-builder-studio.tsx` (autosave → `updateTeacherCourseBuilder`) + serialize in `src/domain/teacher-course.ts:229-232` | writes content into the course doc |
| Function write | `functions/src/index.ts:~538` (`cleanOptionalText(lesson.contentText, 20000)` / `externalUrl, 2000`) | server-side course write — also inlines content |
| Read map | `src/lib/data/published-courses.ts:182-194` (`teacherCourseToLearningCourse`) | maps inline content into `Course` |
| Read consume | `src/components/learn/enrolled-course-workspace.tsx:893-967` | renders `lesson.contentText` / `externalUrl` |
| Types | `src/domain/learning.ts:28-29`, `src/domain/teacher-course.ts:64-65` | `contentText?` / `externalUrl?` |

## The fix — gated subcollection `courses/{courseId}/lessonContent/{lessonId}`

Mirror the existing `courses/{courseId}/assets` pattern (`firestore.rules:1592-1611`).
Doc shape: `{ contentText: string|null, externalUrl: string|null }`. `lessonId` = the lesson's id.

### Rules (add inside `match /courses/{courseId}`)

```
match /lessonContent/{lessonId} {
  allow read: if isAdmin()
    || ownsCourse(courseId)
    || hasEnrollmentForCourseSlug(courseId)
    // Free-preview lesson stays publicly readable (marketing). Without this
    // the public preview breaks once content leaves the doc.
    || (
      courseExists(courseId)
      && courseData(courseId).status in ['published','in_review']
      && courseData(courseId).get('freePreviewLessonId', '') == lessonId
    );
  allow write: if teacherCanManageCourseAssets(courseId)   // owner or admin
    && request.resource.data.keys().hasOnly(['contentText','externalUrl'])
    && (request.resource.data.contentText == null || (request.resource.data.contentText is string && request.resource.data.contentText.size() <= 20000))
    && (request.resource.data.externalUrl == null || (request.resource.data.externalUrl is string && request.resource.data.externalUrl.size() <= 2000));
}
```

**CRITICAL nuance:** the free-preview lesson must stay publicly readable, else
the public course page's free preview goes blank. The rule branch above handles it.

### Write path (dual-write, then cut over)

1. **Phase 1 (zero-downtime):** keep writing `contentText`/`externalUrl` inline in
   the course doc AND mirror them into `lessonContent/{lessonId}` in the same
   batched write. Delete content docs for removed lessons. Update BOTH the client
   (`course-builder-studio` save / `teacher-course.ts` serialize) and the function
   (`index.ts:~538`). Leak still open, but nothing breaks.
2. **Phase 2 (after copy+verify below):** stop writing content inline (write only
   to the subcollection), then run the STRIP backfill.

### Read path (subcollection-first, inline fallback)

`enrolled-course-workspace` subscribes to `courses/{id}/lessonContent` and merges
`contentText`/`externalUrl` onto the matching lessons; **fall back to the inline
field** when a subcollection doc is absent (handles un-migrated docs during
transition). `teacherCourseToLearningCourse` stops requiring inline content.

### Backfill script (`scripts/backfill-lesson-content.mjs`, firebase-admin)

- `--copy` (default, **non-destructive, idempotent**): for every course, for every
  lesson with `contentText||externalUrl`, write `lessonContent/{lessonId}`.
- `--verify`: assert every inline-content lesson now has a matching subcollection
  doc (deep-equal `contentText`+`externalUrl`). Print mismatches; exit non-zero if any.
- `--strip` (**destructive — run only after `--verify` passes AND read path is
  live**): rewrite each course doc removing `contentText`/`externalUrl` from
  `modules[].lessons[]`. Re-read + re-verify each course immediately before its
  strip to avoid races. The subcollection copy is the recovery backup.

### Deploy sequencing

1. Deploy rules (add `lessonContent`) — additive, safe.
2. Deploy app: dual-write + subcollection-first/inline-fallback read.
3. Run `--copy` then `--verify` (additive; safe to run live).
4. Deploy app: write subcollection-only.
5. Run `--strip` (closes the leak), then `--verify` again.

### Tests (`tests/firestore-rules.ts`)

- enrolled (active/completed) reads `lessonContent` → succeeds
- non-enrolled signed-in / unauthenticated → denied
- non-preview lesson, unauthenticated → denied; free-preview lesson on a
  published course, unauthenticated → succeeds
- course owner / admin reads + writes → succeeds; oversized contentText → denied
- a stranger writing another owner's `lessonContent` → denied

## Effort / risk

Involved (6 surfaces + backfill + tests). Risk concentrated in the backfill and
the read-path refactor of the workspace. Do it in a supervised window with the
ability to watch production and roll back hosting fast.
