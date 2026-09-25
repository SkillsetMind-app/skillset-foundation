# Changelog

## 2026-05-22

- `[P6-fix][frontend]` Fixed the collapsed sidebar active state so the active icon remains visible inside a white chip instead of becoming a blank square.
- `[P6-fix][frontend]` Removed the duplicate header `+` course CTA and routed the single `New course` action to the Teacher Studio create-course modal.
- `[P6-fix][frontend]` Reworked account navigation copy and grouping so Settings contains profile/email/security/notifications while Billing and creator Payouts are separated.
- `[P6-fix][frontend]` Added stronger dashboard visual hierarchy with a shaped hero card, stronger metric cards, and clearer Billing/Payouts callouts to reduce the all-white workspace feel.
- `[P6-fix][payments]` Tightened the setup banner so Stripe setup only clears after both charges and payouts are enabled, and added manual Stripe status refresh in Payouts.
- `[P6-fix][courses]` Added free creator-course enrollment through a callable Function, updated course detail CTAs for free courses, and redirected legacy learner course URLs to creator-course workspaces.
- `[P6-fix][courses]` Blocked Course Builder submit and admin publish actions unless the course has structure plus either a free enrollment model or a paid price greater than zero.
- `[P6-fix][courses]` Expanded lesson material uploads to support Office documents, slides, spreadsheets, ZIP files, and audio, and added trusted YouTube/Vimeo embeds inside public previews and learner workspaces.
- `[P6-fix][build]` Fixed Next/Turbopack root detection for this Windows workspace and excluded visual reference exports from ESLint.
- `[P6-reference][design]` Imported Skillset DESIGN V2 reference files into `docs/design-reference/skillset-design-v2-2` for page-by-page implementation guidance.
- `[deploy][firebase]` Published Firestore rules, Functions, and Hosting to `skillsetusaofficial`; confirmed `createFreeCourseEnrollment`, `createCheckoutSession`, `refreshTeacherStripeAccount`, `stripeWebhook`, and `ssrskillsetusaofficial` are deployed.
- `[deploy][stripe]` Verified the live Stripe webhook endpoint for `stripeWebhook`, restricted it to the 8 event types handled by the backend, updated the Firebase `STRIPE_WEBHOOK_SECRET`, and redeployed the webhook function.
- `[P6-MVP][courses]` Moved teacher course creation to a transactional callable Function with normalized `titleKey` claims so duplicate course names are blocked before draft creation.
- `[P6-MVP][courses]` Expanded Course Builder to support up to five course categories, module descriptions, module-targeted cover uploads, trusted YouTube/Vimeo embeds, and broader lesson material formats.
- `[P6-MVP][learn]` Made real teacher-published courses open at canonical `/learn/courses/{courseId}` URLs, added protected course-level file opening, and added enrolled-only lesson comments with delete-own-comment support.

## 2026-05-11

- `[P6-HM-1][frontend]` Refined the home page copy around verified capabilities, added the Skillset Promise preview band, added reveal-on-view motion for marketing sections, and removed unused mock marketing components.
- `[P6-AV-1][frontend]` Added authenticated user refresh after avatar upload and made avatar URLs cache-busting so header/sidebar avatars update without a manual reload.
- `[P6-OB-1][frontend]` Replaced the minimal welcome choice with a Typeform-style onboarding wizard that saves answers incrementally and resumes incomplete onboarding.
- `[P6-SB-1][frontend]` Added a collapsible platform sidebar with persistent local state, hover expansion, a compact session avatar state, and mobile bottom navigation with a drawer.
- `[P6-AM-1][frontend]` Extracted AccountMenu into a shared component, added producer/learner switch view, and connected the same avatar menu to the platform header.
- `[P6-ADD-01/04/27][frontend]` Added platform setup status banners, a notification bell empty state, and a floating help bubble for authenticated surfaces.
- `[P6-ADD-07/17/19][frontend]` Added shared table empty rows, listing search bars, and canonical status chips across teacher, learner, support, and ops surfaces.
- `[P6-ADD-02/03/06/08/09][frontend]` Reworked Teacher Studio with horizontal tabs, dashboard filters, a revenue milestone strip, a status filter, and a create-course modal that routes into Course Builder.
- `[P6-ADD-12/13][frontend]` Added a read-only members-area preview route for Course Builder and a canonical Preview button in the builder header.
- `[P6-ADD-14/23/24/25/26][frontend]` Added Teacher Studio surfaces for co-productions, refunds, coupons, team, and integrations with honest placeholder states where backend flows are still P2.
- `[P6-ADD-10/11][frontend]` Added password requirement checklists to signup and account security, implemented password change with Firebase reauthentication, and added E.164 phone capture to profile settings.
- `[P6-ADD-02/03][frontend]` Added URL-synced horizontal tabs to billing and operations, plus canonical period/status filters for the ops workspace.
- `[P6-ADD-18/20][frontend]` Added canonical plan selector cards and a Course Builder payment model section for one-time, free, and future subscription courses with installment controls.
- `[P6-ADD-15/16][frontend]` Added inline contextual help and client-side CSV/JSON export controls for payments, support tickets, and course review queues.
- `[P6-ADD-22][frontend]` Added a Teacher Studio sale detail route with payment summary, Stripe IDs, timeline, course context, and links from recent wallet sales.
- `[P6-ADD-05][frontend]` Added an authenticated-workspace theme provider and light/dark toggle without changing public marketing pages.

## 2026-05-11 — Executor session (Claude)

- Verified real state: 31 Fase 6 commits were stuck on `fase-6-organize`; merged into `main` and pushed.
- Security audit: no secrets committed to repo; `.gitignore` covers `.env*`; clean.
- Stripe verified via API (read-only): LIVE account `acct_… (conta da plataforma)` "SKILLSET USA" — Connect ENABLED, LIVE webhook configured with 4 required events. Code stack consistently TEST mode (correct pre-QA).
- Added `docs/skillset-executor-plan-2026-05-11.md` and `docs/stripe-go-live-runbook.md` (cost answer + cutover steps).
- Fix: removed teacher double-onboarding loop. Wizard-completed teachers now hit a single streamlined activation (email verification + Teacher Terms) instead of re-answering path/profile/goals. Security role-grant gate preserved.
- Verified: lint, build (71 routes), 33 tests all green.
