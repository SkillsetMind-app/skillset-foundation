# DATA MODEL
## Firestore and Storage entities

> **Version:** 0.1.0
> **Updated:** 2026-05-25
> **Status:** Living document

---

## Primary Collections

| Collection | Purpose | Primary Owner |
|------------|---------|---------------|
| `users` | User profile, roles, onboarding, Stripe Connect status, current plan. | User and backend functions. |
| `courses` | Teacher course drafts, published courses, builder state, pricing, review status. | Teacher and admin. |
| `courses/{courseId}/assets` | Course covers, lesson videos, thumbnails, downloadable materials. | Course owner. |
| `enrollments` | Learner access to courses and progress status. | Backend functions. |
| `orders` | Payment and purchase records. | Stripe webhook and backend functions. |
| `payoutLedger` | Teacher revenue release records. | Backend functions. |
| `certificates` | Issued and verifiable credentials. | Backend functions. |
| `communityPosts` | Course/community discussion records. | Authenticated users. |
| `supportTickets` | Support and operations workflow. | User/support/admin. |

---

## User Profile

Source type: `src/domain/user-profile.ts`

| Field | Meaning |
|-------|---------|
| `uid` | Firebase Authentication user ID. |
| `email` | User email. |
| `displayName` | Public display name. |
| `username` | Optional profile handle. |
| `roles` | Includes `student`, `teacher`, `admin`, or support roles. |
| `onboardingCompleted` | Whether the welcome wizard is complete. |
| `onboardingAnswers` | Structured onboarding answers. |
| `teacherTermsAcceptedAt` | Teacher legal acceptance timestamp. |
| `stripeConnectedAccountId` | Stripe Connect Express account ID. |
| `stripeConnectChargesEnabled` | Whether the teacher can accept charges. |
| `stripeConnectPayoutsEnabled` | Whether payouts are enabled. |
| `currentPlanId` | Current creator plan mirrored from billing state. |

---

## Course

Source type: `src/domain/teacher-course.ts`

| Field | Meaning |
|-------|---------|
| `ownerId` | Teacher user ID. |
| `title` | Course title. |
| `titleKey` | Normalized unique title key. |
| `summary` | Course description. |
| `category` | Primary category. |
| `categories` | Up to five categories. |
| `status` | `draft`, `in_review`, `needs_changes`, `published`, or `inactive`. |
| `modules` | Course modules and nested lessons. |
| `lessonCount` | Derived lesson count. |
| `priceAmountMinor` | Price in minor currency unit. |
| `currency` | Course currency. |
| `paymentType` | `one_time`, `free`, `subscription_monthly`, or `subscription_yearly`. |
| `dripStrategy` | Release strategy for protected content. |
| `freePreviewLessonId` | Lesson available before payment. |
| `coverImageUrl` | Public cover image URL. |

---

## Course Module

| Field | Meaning |
|-------|---------|
| `id` | Client-generated module ID. |
| `title` | Module title. |
| `summary` | Optional module summary. |
| `coverAssetId` | Optional asset ID for module cover. |
| `lessons` | Ordered lesson list. |

---

## Lesson

| Field | Meaning |
|-------|---------|
| `id` | Client-generated lesson ID. |
| `title` | Lesson title. |
| `type` | `video`, `text`, `quiz`, `assignment`, `live_recording`, `download`, or `external_embed`. |
| `description` | Lesson description. |
| `durationMinutes` | Optional duration estimate. |
| `contentText` | Text lesson content. |
| `externalUrl` | External video or embed URL. |
| `videoSource` | Explicit lesson video source: `youtube` or `upload`. |
| `dripDelayDays` | Optional lesson-specific delay. |
| `thumbnailAssetId` | Optional lesson thumbnail asset. |

---

## Course Assets

Storage path:

```text
courses/{courseId}/assets/{ownerId}/{assetId}/{fileName}
```

Allowed MVP upload categories:

| Category | Examples |
|----------|----------|
| Images | Course covers, module covers, lesson thumbnails. |
| Videos | Native lesson video uploads. |
| Audio | Audio lesson or supporting material. |
| Documents | PDF, Word, PowerPoint, Excel, text, CSV. |
| Archives | ZIP supporting packs. |

Storage rules currently limit uploads to 500 MB per file.

---

## Ownership Rules

| Entity | Write Rule |
|--------|------------|
| User profile | User can update safe identity fields; backend owns sensitive payment fields. |
| Course | Teacher owns draft/editable course; admin can review and publish. |
| Course asset | Course owner can upload while course is editable. |
| Protected asset read | Admin, course owner, or active/completed enrollment. |
| Order | Backend only. |
| Payout ledger | Backend only. |

