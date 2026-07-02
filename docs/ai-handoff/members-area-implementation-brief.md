# Implementation Brief — Teacher Members-Area + Student Vitrine (Instructor Storefront)

> **For:** the coding agent working on `skillset-foundation`.
> **Self-contained:** you can execute from this file alone. Every path/symbol below was verified against the codebase on 2026-06-23.
> **Stack:** Next.js 16 App Router · React 19 · Tailwind 4 · Firebase (Firestore + Cloud Functions, SSR on Cloud Run). **Branch:** `fix/payment-subscription-and-demo-cta`.
> **Companion (rationale + benchmark):** `docs/plans/2026-06-23-members-area-architecture.md`.

---

## 1. Mission

Let a **teacher** configure a branded space (their "members area") and let a **student** see a **configurable storefront/vitrine** — Hotmart/Kajabi-style — **without building a second platform**.

## 2. The ONE principle: AUGMENT, do not REPLACE

~70% already exists. The "two-surface" pattern (public showcase ↔ auth-gated members area, joined by `Enrollment`) is already implemented. **Do not rebuild any of these:**

| Surface | Already lives in |
|---|---|
| Public catalog/vitrine | `src/components/courses/course-marketplace.tsx` (`/courses`) |
| Per-course sales page | `src/components/courses/creator-course-detail.tsx` (`/courses/[slug]`) |
| Members area (consumption) | `src/components/learn/enrolled-course-workspace.tsx` (`/learn/courses/[slug]`) |
| Student home | `src/components/learn/learn-dashboard.tsx` (`/learn`) |
| Teacher edits course content | `src/components/teacher/course-builder-studio.tsx` (~2.7k lines) |
| Teacher previews student view | `src/app/teach/builder/[courseId]/preview/page.tsx` |
| Access gate | `Enrollment` (`src/domain/enrollment.ts`) |

The **only** real gap is the **instructor-as-brand** layer: per-teacher branding + a public page that aggregates one teacher's brand + all their courses.

## 3. Locked architecture decisions (do not relitigate)

1. **Instructor = tenant.** Reuse `users/{uid}` + the existing anon-readable `publicProfiles/{uid}` projection. **NO new `School`/`Organization` collection.** No co-instructor/team model in v1.
2. **Separate-surfaces model** (Kajabi/Teachable/Thinkific), NOT Hotmart's unified sales-inside-members. Keep public (`/courses`, `/instructors`) and private (`/learn`) distinct.
3. **Theming via scoped CSS-variable override.** The app themes 100% through `--color-*` tokens — branding is a runtime token override on a scoped wrapper, never a redesign.

## 4. Verified anchor map (exact paths/symbols)

| Concern | Path : line | Symbol | Action |
|---|---|---|---|
| Tenant root (private, editable) | `src/domain/user-profile.ts:56` | `UserProfile` (embeds `preferences?: UserPreferences` at `:105`) | ADD `storefront?: StorefrontConfig`, mirroring the `preferences` embed pattern |
| Public projection trigger | `functions/src/index.ts:1587` | `syncPublicTeacherProfile` (`onDocumentWritten("users/{uid}")`) | no trigger change — only widen the projection fn below |
| Projection function | `functions/src/index.ts:1550` | `projectPublicTeacherProfile()` → currently returns `{ displayName, username, photoURL, bio, credentials }` | ADD a **public subset** of `storefront` to the returned object |
| URL sanitizer (REUSE) | `functions/src/index.ts` (~`:1576`) | `sanitizePublicPhotoUrl(...)` | reuse to sanitize `logoUrl` / `heroImageUrl` before projecting |
| Public read rules | `firestore.rules:1558` | `match /publicProfiles/{uid} { allow read: if true; allow write: if false; }` | NO change — function stays the only writer |
| URL write guard (PATTERN) | `firestore.rules:290-297` | `photoURL` https + `size() <= 1200` guard on the `users` write path | COPY this pattern for the new `storefront` URL fields |
| Course product node | `src/domain/teacher-course.ts:78,80` | `TeacherCourse` keyed by `ownerId` | the foreign key the storefront grid queries on |
| Published-courses query | `src/lib/data/published-courses.ts:21` | `subscribeToPublishedTeacherCourses(...)` (flat) | add an `ownerId`-scoped variant for the vitrine |
| Course-card mapper (REUSE) | `src/lib/data/published-courses.ts:88` | `teacherCourseToCourseCard(course)` | reuse to render the vitrine grid cards |
| Student vitrine surface | `src/components/instructors/instructor-profile-view.tsx` + `src/app/instructors/[slug]/page.tsx` | — | UPGRADE into the branded storefront |
| Permission area (PATTERN) | `src/lib/permissions/index.ts:146-155` | `teacherStudio.manageCourses` | ADD `teacherStudio.manageStorefront` (mirror; wire into `rolePermissionMatrix` ~`:302`) |
| Teacher routes | `src/app/teach/*` (`builder`, `sales`, `media`, `events`, `coupons`, `team`, …) | — | ADD `src/app/teach/storefront/page.tsx` |

## 5. Data model to add

```ts
// src/domain/user-profile.ts  — embed on UserProfile (like `preferences`)
export type StorefrontConfig = {
  branding?: {
    accentColor?: string | null;     // validated hex (#rrggbb)
    logoUrl?: string | null;         // https only; sanitized like photoURL
    heroImageUrl?: string | null;    // https only; sanitized like photoURL
    themePreset?: "default" | "warm" | "cool" | "mono" | null;
  };
  showcase?: {
    tagline?: string | null;
    orderedCourseIds?: string[];     // explicit ordering of this teacher's published courses
    featuredCourseId?: string | null;
    sectionLabels?: string[];
  };
};
// add to UserProfile:  storefront?: StorefrontConfig;
```
The **public subset** projected into `publicProfiles/{uid}` should include only safe, render-needed fields: `branding.{accentColor, logoUrl, heroImageUrl, themePreset}` and `showcase.{tagline, orderedCourseIds, featuredCourseId, sectionLabels}`. Mirror the projection type next to `PublicProfileProjection` in `functions/src/index.ts`. No new collection — `TeacherCourse` stays keyed by `ownerId`; the storefront is a VIEW over `ownerId`.

## 6. The three surfaces

- **PUBLIC (anon):** `/courses`, `/courses/[slug]`, and the new star **`/instructors/[slug]`** → branded hero (logo + tagline + accent) + grade of the teacher's published courses.
- **PRIVATE (auth + `Enrollment`):** `/learn`, `/learn/courses/[slug]`, `/learn/credentials` — already exist.
- **TEACHER CONFIG (auth + `teacherStudio`):** existing `/teach/builder` (content) + new **`/teach/storefront`** (branding + ordering) + existing preview route.

## 7. Phased tasks (additive; each phase independently shippable)

### Phase 1 — `StorefrontConfig` model + teacher editor
- Add `StorefrontConfig` to `src/domain/user-profile.ts`.
- New route `src/app/teach/storefront/page.tsx` + a panel component (follow `src/components/account/profile-settings-panel.tsx` conventions) to edit branding + course ordering.
- Add permission `teacherStudio.manageStorefront` in `src/lib/permissions/index.ts` and grant it where `manageCourses` is granted.
- `firestore.rules`: on the `users/{uid}` self-update path, allow the owner to write `storefront`, applying the `photoURL`-style guards (https + length) to `logoUrl`/`heroImageUrl` and a hex check on `accentColor`.
- **Done when:** a teacher saves branding + ordering and it persists/reloads. Nothing renders publicly yet (pure additive).

### Phase 2 — Project to public + build the vitrine
- Widen `projectPublicTeacherProfile()` (`functions/src/index.ts:1550`) to project the public subset of `storefront`, sanitizing URL fields with `sanitizePublicPhotoUrl`.
- Add an `ownerId`-scoped published-courses query in `src/lib/data/published-courses.ts` (next to `subscribeToPublishedTeacherCourses:21`).
- Upgrade `src/components/instructors/instructor-profile-view.tsx` to read `publicProfiles` branding + render a hero and the course grid (reuse `teacherCourseToCourseCard:88`), honoring `showcase.orderedCourseIds` / `featuredCourseId`.
- **Done when:** a signed-out visitor opens `/instructors/[slug]` and sees the teacher's brand + all their published courses on one page.

### Phase 3 — Branding theming pass
- Apply `branding.accentColor` / `themePreset` as **scoped `--color-*` overrides** on the vitrine wrapper (and optionally `/learn` — see Non-goals). Platform defaults when unset.
- **Done when:** the vitrine reflects the teacher's accent with zero regression to the global theme.

### Phase 4 — (optional, parallelizable) genuine learning gaps
Independent of the storefront; pick up only if scoped in: video resume (`lastPosition` on `LessonProgress` + player wiring), real certificate PDF (replace `window.print()` with a PDF lib), course→course upsell. *Quiz/assessment is a large separate milestone — do not bundle.*

## 8. Security must-dos (non-negotiable)

- `logoUrl` / `heroImageUrl` are projected into the **world-readable** `publicProfiles` doc → they MUST pass `sanitizePublicPhotoUrl` (functions) AND a `photoURL`-style https/length guard on the `users` write rule (`firestore.rules:290-297` is the template). No raw user URLs reach the public doc.
- Keep `publicProfiles` write rule `if false` — the Cloud Function stays the sole writer. Never let clients write the public doc.
- `accentColor` must be validated as a hex string before it ever reaches a `style`/CSS var (prevent CSS/style injection).
- **Coordination:** treat lesson-content privacy as **not yet guaranteed** on this platform; before public-rendering anything that references lesson content, confirm with the repo owner. Don't expand public surfaces over content whose access model is still being hardened.

## 9. Non-goals (anti-scope-creep — defer to v2+)

Custom domain (CNAME/DNS) · multi-tenant `School` collection · full white-label · native branded app · school-wide community/gamification · Offer abstraction (multi-offer/bundles) · co-instructors/teams. These are **differentiators**, not table-stakes. If a task seems to require one, STOP and flag it.

## 10. Gates & conventions (run before declaring done)

- `npm run lint` · `npm run typecheck` · `npm test` · `npm run test:rules` · `npm --prefix functions run build`.
- Add Firestore-rules tests in `tests/firestore-rules.ts` for the new `storefront` write paths (owner can write valid; non-owner denied; bad URL/hex denied).
- Conventions: **absolute imports** (`@/…`), **no `any`**, props interfaces typed, Conventional Commits. **`git push` is @devops-only** — do not push.

---
*Decisions locked 2026-06-23. Build the seam, not a second platform.*
