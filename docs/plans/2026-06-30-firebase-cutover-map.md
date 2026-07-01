# Firebase → Supabase Cutover Map + Architecture Decisions

> **Created:** 2026-06-30. Source: read-only recon of `skillset-foundation`.
> **Status:** Reference for the cutover phases of the GSD build. Schema (27 tables + money) is the migration foundation; this doc is the app-rewiring surface.
> **Supabase project:** `ijtikldtjvsbtwszokvs`.

---

## 1. Coupling surface (where Firebase lives)

| Area | Files | Notes |
|---|---|---|
| **Client init/config** | `src/lib/firebase/client.ts`, `src/lib/firebase/config.ts` | Lazy singletons: Auth, Firestore, Storage, Functions (region us-central1). Env keys `NEXT_PUBLIC_FIREBASE_*` (6). |
| **Admin SDK** | `functions/src/index.ts` (~6-7k lines) | `initializeApp()` + `getFirestore()`. Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` via `defineSecret()`. |
| **Auth** | `src/lib/auth/firebase-auth.ts`, `src/components/auth/auth-provider.tsx`, `src/lib/auth/routing.ts` | email/pass, Google OAuth, **TOTP MFA**, email verify/change. Roles read from `users/{uid}.roles[]` (NOT custom claims) → matches `public.users.roles` jsonb. |
| **Data layer** | `src/lib/data/*.ts` (23 files) | ~85% centralized. `get*/subscribe*/add*/update*/delete*`. 13+ `onSnapshot` realtime listeners. ~5-10 components import `getFirestoreDb()` directly. |
| **Storage** | `src/lib/data/profile-media.ts`, `src/lib/data/course-assets.ts`, `next.config.ts` | avatar, signature, course cover, lesson assets (video ≤5GB). Gated assets via `getBlob()`→blob URL. |
| **Stripe (client)** | `src/lib/payments/checkout.ts` | `httpsCallable(..., "createCheckoutSession")`. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_PAYMENTS_CHECKOUT_ENABLED`. |
| **Stripe (server)** | `functions/src/index.ts` (stripeWebhook ~line 4181), `functions/src/payment-rules.ts`, `stripe-connect-self-heal.ts`, `src/domain/payment-split.ts` | separate charges+transfers, platform fee BPS, transfer hold (default 3d)→daily release, refund clawback via `charge.refunded`, two sub tracks (course + plan). |
| **Analytics** | PostHog (`NEXT_PUBLIC_POSTHOG_*`) | orthogonal to backend; leave as-is. |

### Collection → table mapping (schema already built)
users, publicProfiles, courses, `courses/{id}/assets`→**course_assets**, `courses/{id}/lessonContent`→**course_lesson_content**, enrollments, orders, payoutLedger, courseReviews, courseSubscriptions→**subscriptions**, certificates, lessonProgress, lessonComments, communityPosts + `/likes` + `/comments`→**community_post_likes / community_comments**, communityReports, gamification→**member_stats/points_events/leaderboards**, courseEvents (+ rsvps), notifications, `wishlist/{uid}/items`→**wishlists**, accountActionRequests, supportTickets, auditLog, courseTitleKeys, rateLimits, processedStripeEvents, checkoutLocks. Money 6 (orders/payments/payoutLedger/subscriptions/checkoutLocks/processedStripeEvents) → **being authored by the money-domain workflow**.

---

## 2. Cloud Functions inventory (the heavy lift)

- **Callables (~21):** createTeacherCourseDraft, updateTeacherCourseBuilder, submitTeacherCourseForReview, deleteTeacherCourseDraft, deleteCourseAsAdmin, createCheckoutSession, createFreeCourseEnrollment, submitCourseReview, createTeacherStripeAccountLink, refreshTeacherStripeAccount, requestRefund, issueSkillsetCertificate, recordLessonProgress, issueAdminRefund, verifySkillsetCertificate, requestDataExport, requestAccountDeletion, createBillingCheckoutSession, createBillingPortalSession, cancelCourseSubscription, createConnectAccountSession.
- **Firestore triggers (6):** onCoursePublished (analytics), **syncPublicTeacherProfile** (users→publicProfiles projection), onCommunityLikeCreated/Deleted (likeCount±), onCommunityCommentCreated (commentCount + notification), onEnrollmentCreated (analytics).
- **Scheduled (5):** rebuildLeaderboards (daily), rebuildTrending (4h), expireStalePendingOrders (1h), dailyReleaseTransfers (daily, Stripe transfers + refund reversals).
- **Stripe webhook (1):** two-phase idempotency (claim→done via processedStripeEvents); handles checkout.session.completed (payment+subscription), async_payment_*, expired, payment_intent.payment_failed, charge.refunded, customer.subscription.*, invoice.payment_failed, invoice.paid, account.updated.

---

## 3. Architecture decisions (decided autonomously — overridable on return)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| A | **Functions target** | **Next.js Route Handlers + Server Actions** (App Router), NOT Supabase Edge Functions | It's a Next.js 16 app. One codebase, one deploy, `@supabase/supabase-js` with `service_role` server-side (bypasses RLS for trusted writes), simpler local dev, Stripe webhook = one `route.ts`. Edge Functions only if we later need to decouple. |
| B | **Auth** | **Supabase Auth** | email+password, Google OAuth, TOTP MFA all native. Roles stay in `public.users.roles` jsonb (already built). Next.js middleware validates the Supabase JWT; `auth.uid()` drives RLS. On signup, a trigger (or server action) upserts the `public.users` row. |
| C | **Realtime** | **Supabase Realtime (postgres_changes) for live surfaces only** — order status, notifications, community feed. Everything else = fetch-on-load + revalidate. | RLS-aware Realtime is native but not free to wire 13×. Pre-launch, most `onSnapshot` can be plain fetches; reserve WebSocket for the few genuinely-live views. |
| D | **Storage** | **Supabase Storage for images** (avatars, covers, signatures); **Cloudflare R2 for course video** | R2 = zero egress, better for ≤5GB video delivery; Patrick already has R2 + Cloudflare in the cofre. Signed URLs for gated content (replaces `getBlob()` pattern). |
| E | **Scheduled jobs** | **pg_cron** for pure-DB jobs (expireStalePendingOrders, rebuildLeaderboards, rebuildTrending); **Vercel Cron → Next.js route** for Stripe-touching jobs (dailyReleaseTransfers) | pg_cron ships with Supabase; keep DB work in DB. Stripe transfers need the SDK → a route. |
| F | **DB aggregation triggers** | **Postgres triggers** | likeCount/commentCount counters and syncPublicTeacherProfile (users→public_profiles upsert) become BEFORE/AFTER triggers — same pattern already used in layer 2/3. |
| G | **Idempotency / locks** | **Postgres**: processed_stripe_events PK on event id (dup insert conflicts); checkout_locks backend-only | Replaces the two-phase Firestore claim with a UNIQUE-constraint conflict. |
| H | **Course title uniqueness** | `courses.title_key` UNIQUE (already in schema) + insert-conflict | replaces courseTitleKeys transaction. |

---

## 4. Env var mapping (names only — values live in the cofre, never here)

| Firebase (remove) | Supabase (add) |
|---|---|
| NEXT_PUBLIC_FIREBASE_API_KEY + 5 others | NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY |
| (Admin SDK / GOOGLE_APPLICATION_CREDENTIALS) | SUPABASE_SERVICE_ROLE_KEY (server-only) |
| STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET | unchanged (still Stripe) |
| NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY | unchanged |
| — | R2: bucket + S3 access key/secret + account id (server-only) |
| next.config.ts image domains: firebasestorage.googleapis.com | → supabase storage domain + R2/custom domain |

---

## 5. Ranked cutover effort (for GSD phase ordering)

1. **Auth swap** (Supabase Auth + middleware + users-row upsert) — unblocks everything.
2. **Data-layer swap** (`src/lib/data/*.ts` × 23 → `@supabase/supabase-js` queries; RLS already enforces access).
3. **Callables → Next.js routes/server actions** (~21) + Admin SDK → service-role client.
4. **Stripe webhook → Next.js route** + money tables + payout/refund/idempotency logic.
5. **Storage** (Supabase images + R2 video, signed URLs).
6. **Realtime** (3 live surfaces) + **scheduled jobs** (pg_cron + Vercel Cron) + **DB triggers** (counters, profile projection).

> This cutover is the P0 spine of the unified GSD build — it IS most of "payments work, members area works, login/signup work, video upload works." The psychology-niche vision (P1) layers on top once the app runs on Supabase. Doing it once, here, avoids a lift-and-shift that the vision would overwrite.
