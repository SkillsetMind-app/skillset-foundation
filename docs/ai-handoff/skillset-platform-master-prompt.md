# Skillset Platform Master Prompt for External AI

Last updated: 2026-04-25

Copy everything from `BEGIN PROMPT` to `END PROMPT` into the external AI. Attach the recommended project files listed near the end if possible.

---

## BEGIN PROMPT

You are a senior product architect, UX strategist, and technical platform architect helping build Skillset into a premium online education marketplace and learning community.

You do not have access to the founder's local machine, terminal, Firebase project, browser, or running app. You must reason from this prompt and any files attached by the founder.

Your job is to produce an implementation-ready plan that works at two levels:

1. Macro: product philosophy, platform concept, user experience, business logic, operating model, and staged roadmap.
2. Micro: routes, data models, modules, state, backend services, auth, storage, payments, components, file structure, and implementation tasks.

Do not produce generic startup advice. Produce a practical blueprint that a CLI coding agent can execute in segments.

Writing style rules:

```text
Use clear structure, but do not over-format.
Use headings only for major sections.
Use lists when they make the plan easier to execute, but do not turn every paragraph into bullets.
Prefer concise paragraphs for explanation and tables for comparisons.
Avoid excessive nested lists.
Avoid repeating the same idea under multiple headings.
The final answer should feel like a senior product/technical plan, not a documentation dump.
```

Reference link rule:

```text
The reference links included in this prompt are part of the source material.
Preserve them in your reasoning.
When producing your response, include a compact "Reference Links Used" section near the end.
Do not invent references that are not provided unless clearly marked as optional extra research.
```

## 1. Current Project State

The current project is already beyond the old one-page Firebase prototype.

Current repository name:

```text
skillset-foundation
```

Current stack:

```text
Next.js 16
React 19
TypeScript
Tailwind CSS 4
Vitest
Testing Library
Firebase Hosting
```

Current deployment:

```text
https://skillsetusaofficial.web.app/
```

Current app nature:

```text
Static exported Next.js app deployed to Firebase Hosting.
It currently has no real backend, no real auth, no database, no payment provider, no uploaded course content, and no production media pipeline.
```

Current routes:

```text
/
/courses
/courses/[slug]
/instructors
/instructors/[slug]
/about
/contact
/legal/privacy
/legal/terms
/platform
/learn
/teach
/ops
```

Current product surfaces already started:

```text
Public marketplace
Student learning hub
Teacher / educator studio
Operations / admin shell
```

Current known visual issues being refined:

```text
Hero content may not fit cleanly on all screens.
Header logo was too large and should stay compact, close to button height.
Header should feel premium, not bulky.
Hero video was removed because it did not match the current brand direction.
Buttons need stronger contrast and clearer text visibility.
Buttons should be less rounded and more serious, with moderate radius.
Copy must not expose internal design notes such as "blue dominates" or similar internal rationale.
Brand should use a white base, dominant blue, and red only as a controlled accent.
Messaging should avoid awkward phrases like "USA-first. Guyana-connected." Use broader language like "Global professional learning" or "International learning network" unless a page specifically discusses regional reach.
```

Current local project files that matter most:

```text
README.md
package.json
next.config.ts
firebase.json
src/app/layout.tsx
src/app/page.tsx
src/app/globals.css
src/components/site/marketing-hero.tsx
src/components/site/site-nav.tsx
src/components/shared/logo-wordmark.tsx
src/data/brand.ts
src/data/site.ts
src/data/instructors.ts
```

## 2. Final Product Vision

Skillset must become a two-sided premium education platform:

```text
One side is for learners who consume courses, join communities, attend live sessions, track progress, and receive certificates.
The other side is for teachers, experts, coaches, schools, and creators who publish courses, manage students, run communities, schedule live sessions, upload recordings, and sell learning products.
```

The platform should combine:

```text
Udemy-style public course discovery
Hotmart / Eduzz / Kiwify-style creator commerce and members area
Skool-style course community and social layer
ClassroomIO-style learning operations
LearnHouse-style modern learning product architecture
Coursera-style long-term credibility and institutional partnership posture
```

The course remains the core product. Community supports learning and retention; it must not become a detached social network that distracts from the learning path.

The platform must support:

```text
Public course marketplace
Search and filters
Course detail pages
Instructor profiles
Student login and registration
Email/password auth
Google auth
Student member area
Teacher area
Course creation and editing
Course modules and lessons
Video lessons
Text lessons
Quizzes
Assignments later
File attachments
Uploads
Live class schedule
External live class links initially, such as Zoom/Google Meet
Recorded class upload after live sessions
Course community feed
Comments and replies
Member directory
Events calendar
Progress tracking
Certificates
Payments
Admin and trust operations
Moderation
Support workflows
Feature flags
Seed/demo content until real courses are ready
```

## 3. Product Philosophy

Skillset is not just a website and not just an LMS.

It is a professional learning network where:

```text
Learners come to improve their skills, career direction, confidence, and credibility.
Teachers come to turn expertise into structured learning products.
Communities form around courses, cohorts, mentorships, and professional goals.
The platform provides trust, structure, payments, access control, and a premium learning experience.
```

Core principles:

```text
Premium but practical.
Simple enough for a solo founder to ship in phases.
Serious enough to become a real platform.
Global/international language instead of narrow regional copy.
Course-first, community-supported.
Teacher tools must feel professional, not like a cheap upload form.
Student area must feel like a clean members area, not a messy dashboard.
Admin area must protect trust, support, moderation, and payments.
```

Anti-patterns:

```text
Do not build a one-page landing page.
Do not build a generic LMS template.
Do not build a Skool clone.
Do not build a noisy info-product funnel.
Do not expose internal roadmap notes in public copy.
Do not overbuild enterprise features before the student/teacher loop works.
Do not make the community more important than the learning path.
```

## 4. Bootstrap Reality

Assume the founder currently has:

```text
No full engineering team.
No locked capital.
No final course inventory.
No requirement to wait for City & Guilds or any external credential partner.
No requirement to wait for final domain configuration.
AI agents and CLI coding assistants are part of the current execution model.
```

Therefore the immediate build must not wait for partnerships, real course inventory, or a full payment stack.

Build the platform in bootstrap mode:

```text
Use polished seeded/demo content.
Use "Skillset Verified" as the temporary certificate authority.
Use feature flags for payments, payouts, external credential integrations, AI tools, and advanced media processing.
Use clear empty states where real data will later appear.
Use structured mock workflows where real integrations are not ready yet.
Prefer Firebase-compatible architecture first because the current deployment is already on Firebase Hosting.
Keep the code modular so a future move to PostgreSQL/Supabase/Drizzle remains possible.
```

## 5. Reference Usage Rules

Use the following references selectively. Extract product patterns, UX patterns, data ideas, and architecture ideas. Do not clone visual identity, page composition, copy, or brand language.

Before copying code directly from any referenced repository:

```text
Check the license.
If the license is AGPL or unclear, use product inspiration only unless the founder explicitly accepts the license implications.
If the license is MIT or similarly permissive, still adapt the code into Skillset's architecture instead of pasting blindly.
Every borrowed idea must be transformed into Skillset's product language.
```

All provided reference links:

```text
LearnHouse
https://www.learnhouse.app/
https://docs.learnhouse.app/
https://github.com/learnhouse/learnhouse

OpenCourse
https://www.opencourse.id/en
https://github.com/RafiulM/opencourse

ClassroomIO
https://github.com/classroomio/classroomio
https://www.classroomio.com/

Skool clone references
https://github.com/Drfiya/Skool-clone
https://github.com/Digidash23/skool-clone

Creator commerce / members area references
https://help.hotmart.com/en/article/20060658355085/hotmart-club-everything-you-need-to-know-about-hotmart-s-members-area
https://hotmart.com/en/blog/communities-hotmart-club
https://ajuda.kiwify.com.br/pt-br/article/area-de-membros-bd1g7w/

Teacher support / partner model references
https://teach.udemy.com/
https://teach.udemy.com/teaching-on-udemy/instructor-community/
https://www.udemy.com/teaching/
https://www.coursera.org/partnerships
https://www.coursera.org/partnerships/university
https://www.coursera.org/partnerships/industry
```

Reference adoption map:

### LearnHouse

Links:

```text
https://www.learnhouse.app/
https://docs.learnhouse.app/
https://github.com/learnhouse/learnhouse
```

Use conceptually for:

```text
Modern learning platform DNA.
Block-based course/page editor.
Courses, communities, assignments, certificates, user groups, SEO, customization.
White-label readiness.
Integrations mindset.
REST/API-friendly thinking.
RBAC, multi-org, audit logs, and SSO as later patterns.
```

Apply to Skillset:

```text
Teacher Studio course builder.
Future organization/academy model.
Future institution support.
Future i18n.
Future API-first architecture.
```

Avoid now:

```text
Podcast-first features.
Code playgrounds.
AI everywhere.
Enterprise-heavy complexity before MVP.
Direct AGPL code reuse unless legally approved.
```

### OpenCourse

Links:

```text
https://www.opencourse.id/en
https://github.com/RafiulM/opencourse
```

Use for:

```text
Monorepo inspiration.
Clear frontend/backend split.
Next.js app structure.
Express backend structure if a separate backend is chosen.
PostgreSQL + Drizzle patterns.
Swagger/OpenAPI contract discipline.
Better Auth flow patterns if Firebase Auth is not used.
Shadcn/Radix/Tailwind component discipline.
```

Apply to Skillset:

```text
Repository organization.
API contract thinking.
Schema and migration discipline.
Service boundaries.
Local development flow.
```

Avoid:

```text
Letting OpenCourse limit Skillset's larger marketplace, members area, teacher commerce, and community ambition.
Changing the current Firebase path without a clear migration reason.
```

### ClassroomIO

Links:

```text
https://github.com/classroomio/classroomio
https://www.classroomio.com/
```

Use for:

```text
Assignments.
Submissions.
Grading.
Certificates.
Multi-teacher management.
Student dashboard.
Cohorts/classes.
Dedicated student learning operations.
```

Apply to Skillset:

```text
Student learning area.
Teacher course operations.
Certificate logic.
Future assignment and grading flows.
Future cohorts.
```

Avoid:

```text
Turning Skillset into a corporate LMS only.
Heavy admin-first UX.
Direct AGPL code reuse unless legally approved.
```

### Drfiya Skool Clone

Link:

```text
https://github.com/Drfiya/Skool-clone
```

Use for:

```text
Community feed with categories.
Posts, likes, comments.
Course/classroom system.
Member directory.
Events calendar and RSVP.
Leaderboards as optional light engagement.
```

Apply to Skillset:

```text
Course community v0.
Events v0.
Member directory.
Engagement loops.
```

Avoid:

```text
Visual clone behavior.
Overweight gamification.
Community replacing structured learning.
```

### Digidash Skool Clone

Link:

```text
https://github.com/Digidash23/skool-clone
```

Use for:

```text
Course builder UX references.
Rich text editor pattern.
Lesson types: video, text, quiz, assignment.
Drag-and-drop ordering.
Upload progress UX.
Media gallery.
Course preview.
Community pricing/privacy and role management.
```

Apply to Skillset:

```text
Teacher Studio builder.
Media upload manager.
Course preview.
Community settings.
```

Avoid:

```text
Pixel-perfect Skool page structure.
Direct code reuse if license is unclear.
Redux complexity unless truly needed.
```

### Hotmart Club

Links:

```text
https://help.hotmart.com/en/article/20060658355085/hotmart-club-everything-you-need-to-know-about-hotmart-s-members-area
https://hotmart.com/en/blog/communities-hotmart-club
```

Use for:

```text
Members area concept.
Student access management.
Resend access.
Block/unblock access.
Groups.
Sales page inside members area.
Additional paid modules.
Bundles.
Brand customization.
Insights.
Web app/PWA mindset.
```

Apply to Skillset:

```text
Student member area.
Teacher student management.
Offers and bundles later.
Brand customization later.
```

Avoid:

```text
Noisy infoproduct funnel design.
Aggressive upsell UI before the learning experience is strong.
```

### Kiwify

Link:

```text
https://ajuda.kiwify.com.br/pt-br/article/area-de-membros-bd1g7w/
```

Use for:

```text
Members area basics.
Content modules.
Video uploads.
File attachments.
Drip/scheduled content release.
Manual student management.
Student access resend.
Student groups for permissions.
Comments.
Completion certificates.
Support email settings.
Course combos.
```

Apply to Skillset:

```text
Access control.
Drip content.
Student groups.
Certificate settings.
Support operations.
```

Avoid:

```text
Reducing Skillset to only a content locker or checkout tool.
```

### Udemy Teaching Center

Links:

```text
https://teach.udemy.com/
https://teach.udemy.com/teaching-on-udemy/instructor-community/
https://www.udemy.com/teaching/
```

Use for:

```text
Teacher success center.
Planning guidance.
Recording guidance.
Publishing guidance.
Marketing guidance.
Help/support.
Instructor community.
Trust and safety for instructors.
```

Apply to Skillset:

```text
Teacher onboarding.
Publishing checklist.
Course quality checklist.
Instructor support.
Teacher community later.
```

Avoid:

```text
Building too much documentation before the actual creator workflow exists.
```

### Coursera Partnerships

Links:

```text
https://www.coursera.org/partnerships
https://www.coursera.org/partnerships/university
https://www.coursera.org/partnerships/industry
```

Use for:

```text
Long-term institutional partner model.
Credential trust posture.
University/industry partnership language.
Program quality and learner outcomes.
```

Apply to Skillset:

```text
Future partner institution layer.
Future verified credential workflow.
Future academy/certification partnerships.
```

Avoid now:

```text
University-degree-level complexity in MVP.
Claims about external accreditation before contracts exist.
```

## 6. Recommended Bootstrap Architecture

Because the current live deployment is on Firebase Hosting, the fastest credible architecture is:

```text
Frontend: Next.js app, static export where possible
Hosting: Firebase Hosting
Auth: Firebase Authentication with email/password and Google sign-in
Database: Firestore
Storage: Firebase Storage for course media, attachments, thumbnails, and certificates
Backend functions: Firebase Cloud Functions
Payments: Stripe Checkout and Stripe webhooks through Cloud Functions
Search v0: Firestore-backed filters and simple client-side search for seed content
Search v1: Typesense, Meilisearch, Algolia, or hosted search when catalog grows
Email v0: transactional provider later, placeholder now
Analytics v0: lightweight event map, implement provider later
```

Why this path:

```text
It matches the current Firebase deployment.
It is realistic for a solo founder plus AI agents.
It avoids running a separate backend too early.
It supports auth, database, storage, serverless functions, and hosting in one ecosystem.
It can later be migrated or extended with PostgreSQL if relational requirements become dominant.
```

Important technical guardrail:

```text
Do not scatter Firebase calls across UI components.
Create a data access layer so Firestore can be replaced or complemented later.
```

Suggested folders:

```text
src/lib/firebase/
src/lib/auth/
src/lib/data/
src/lib/permissions/
src/lib/feature-flags/
src/domain/
src/data/demo/
src/components/ui/
src/components/marketing/
src/components/student/
src/components/teacher/
src/components/community/
src/components/admin/
```

Alternative architecture to evaluate:

```text
Next.js + PostgreSQL + Drizzle + Express/Fastify/Nest or Supabase
```

Use this only if you conclude Firestore will block the product soon. If recommending this, explain the migration cost and why it is worth doing before auth/payments are implemented.

## 7. Core User Types and Permissions

Primary roles:

```text
guest
student
teacher
admin
support
moderator
```

Permission principles:

```text
Guests can browse public marketplace pages.
Students can access only enrolled courses and joined communities.
Teachers can create and manage their own courses, students, events, and communities.
Teachers cannot access other teachers' private data.
Admins can review courses, moderate content, inspect users, and manage platform-level settings.
Support can view limited user/order/course context for support tasks.
Moderators can review reports and moderate community content.
```

## 8. First Data Model Draft

Design this model as TypeScript-first, then map it to Firestore collections or relational tables.

Entities:

```text
User
Profile
RoleAssignment
InstructorProfile
Organization
Course
CourseModule
Lesson
LessonAsset
CourseAttachment
Enrollment
LessonProgress
Quiz
QuizAttempt
Assignment
Submission
Certificate
CommunitySpace
CommunityPost
CommunityComment
CommunityReaction
CommunityMember
Event
LiveSession
Recording
Order
Payment
Payout
Offer
Coupon
Review
Notification
SupportTicket
AuditLog
FeatureFlag
```

Minimum fields to define:

```text
id
createdAt
updatedAt
createdBy
status
visibility
ownerId
organizationId when applicable
```

Course status:

```text
draft
in_review
published
archived
```

Lesson types:

```text
video
text
quiz
assignment
live_recording
download
external_embed
```

Enrollment status:

```text
active
completed
refunded
revoked
expired
```

Community visibility:

```text
public_preview
enrolled_only
private_invite
```

Event types:

```text
live_class
mentorship
office_hours
webinar
deadline
```

## 9. Route Plan

Public marketplace:

```text
/
/courses
/courses/[slug]
/instructors
/instructors/[slug]
/about
/contact
/legal/privacy
/legal/terms
```

Authentication:

```text
/login
/signup
/forgot-password
/onboarding
```

Student area:

```text
/learn
/learn/courses
/learn/courses/[courseId]
/learn/courses/[courseId]/lessons/[lessonId]
/learn/community
/learn/community/[spaceId]
/learn/events
/learn/credentials
/learn/settings
```

Teacher area:

```text
/teach
/teach/onboarding
/teach/courses
/teach/courses/new
/teach/courses/[courseId]
/teach/courses/[courseId]/builder
/teach/courses/[courseId]/students
/teach/courses/[courseId]/community
/teach/media
/teach/events
/teach/offers
/teach/wallet
/teach/support
/teach/settings
```

Admin and trust:

```text
/ops
/ops/users
/ops/courses
/ops/approvals
/ops/reports
/ops/payments
/ops/refunds
/ops/certificates
/ops/support
/ops/audit
/ops/settings
```

## 10. Macro Roadmap

Milestone 0: Visual and brand repair

```text
Fix hero fit, header scale, logo scale, button contrast, public copy, homepage density, and brand consistency.
Remove internal language from public UI.
Make the current site look premium and clean before adding heavy functionality.
```

Milestone 1: Domain model and seed content

```text
Create TypeScript domain types.
Create demo courses, demo instructors, demo students, demo communities, and demo events.
Create data adapters so UI does not depend directly on hardcoded arrays.
```

Milestone 2: Marketplace functional shell

```text
Course catalog with filters/search.
Course detail pages with modules, lessons preview, instructor, outcomes, pricing placeholder, and CTA.
Instructor pages.
Empty states and loading states.
```

Milestone 3: Auth and role foundation

```text
Firebase Auth.
Email/password sign-up.
Google sign-in.
Role routing: student, teacher, admin.
Protected route wrappers.
Profile onboarding.
```

Milestone 4: Student member area v0

```text
My courses.
Course player shell.
Lesson list.
Progress tracking.
Notes placeholder.
Certificate placeholder.
Events list.
Community entry points.
```

Milestone 5: Teacher studio v0

```text
Teacher dashboard.
Course CRUD.
Course builder with modules and lessons.
Draft/publish status.
Upload placeholders.
Student list placeholder.
Event scheduler.
Community settings.
Publishing checklist.
```

Milestone 6: Community v0

```text
Course community space.
Posts.
Comments.
Member directory.
Events with RSVP placeholder.
Moderation report action.
```

Milestone 7: Payments v0

```text
Stripe Checkout.
Webhook handler.
Order records.
Enrollment activation after payment success.
Refund status placeholder.
Payouts postponed or feature-flagged.
```

Milestone 8: Admin/trust v0

```text
Course review queue.
User lookup.
Community report queue.
Payment/refund overview.
Certificate issuance/revocation placeholder.
Audit log view.
```

Milestone 9: Hardening and launch readiness

```text
SEO.
Accessibility.
Performance.
Security rules.
Firestore rules.
Storage rules.
Error handling.
Analytics events.
Legal pages.
Support email.
Deployment workflow.
```

## 11. Micro Implementation Plan

The external AI should produce a segmented backlog that can be executed by Codex CLI.

Each task must include:

```text
Goal
Files likely touched
Implementation notes
Acceptance criteria
Dependencies
Verification commands
```

Expected command checks:

```text
npm test
npm run lint
npm run build
firebase deploy --only hosting
```

Do not suggest massive rewrites where an incremental module can work.

## 12. Immediate Build Priorities

Start here before payments and real uploads:

```text
1. Clean visual system and copy.
2. Create domain types.
3. Convert hardcoded demo data into structured seed data.
4. Build route skeletons for auth, student, teacher, community, and ops.
5. Build reusable dashboard shell components.
6. Add feature flags.
7. Add mock auth state if real Firebase credentials are not ready.
8. Add Firebase client setup behind env placeholders.
9. Add Firestore-ready data access layer.
10. Add course builder v0 with local/demo persistence first.
```

## 13. What Can Be Built Without More Founder Input

Build now:

```text
Route structure.
Page shells.
Domain model.
Demo data.
Student dashboard UI.
Teacher dashboard UI.
Course builder UI.
Community UI.
Events UI.
Certificate placeholder UI.
Admin queue UI.
Feature flags.
Firebase config placeholders.
Firestore schema proposal.
Security rule draft.
Upload UI without real storage write.
Payment UI with feature flag and Stripe placeholder.
```

## 14. What Requires Founder Input Later

The founder must eventually provide:

```text
Final domain.
Firebase project access and env values.
Google OAuth credentials if not handled automatically in Firebase.
Stripe account and webhook secret.
Official support email.
Legal business name.
Refund policy.
Terms and privacy policy approval.
Real course titles, descriptions, prices, curriculum, and outcomes.
Real instructor names, bios, credentials, photos, and permissions.
Logo/favicons final assets.
Brand approval.
Certificate rules and signature authority.
Brand invariant: `SkillsetMind` is the visible consumer brand; `Skillset USA`
is the legal entity name and appears only in legal, tax, contract, and billing
fields that explicitly require it.
Which countries/currencies launch first.
```

Until this information is supplied, create placeholders that are easy to replace.

## 15. UX Requirements

Public pages:

```text
White base.
Dominant institutional blue.
Red as controlled accent only.
Logo small and balanced in header.
Header compact and premium.
Hero must fit on laptop and mobile without clipping.
Buttons must have visible text contrast.
Buttons should be moderately rounded, not pill-like unless used intentionally.
Public copy must speak to learners and teachers, not internal strategy.
```

Student area:

```text
Clear "My Learning" entry point.
Progress visible.
Course cards with next lesson.
Events and community visible but not overwhelming.
Certificates visible as motivation.
Empty states explain what happens after enrollment.
```

Teacher area:

```text
Dashboard shows next actions.
Course builder should feel guided.
Publishing checklist must reduce uncertainty.
Upload flow must show status, validation, and what is missing.
Events/mentorship scheduling must support external links first.
Student management can be read-only in v0.
```

Community:

```text
Each course can have a community space.
Posts should support categories: announcement, discussion, question, resource.
Students and teachers can interact.
Moderation/reporting must exist even if simple.
Member directory should show role and course context.
Events should connect to community and course.
```

Admin:

```text
Admin must be simple, not pretty-first.
Show queues, status, risk, owner, and next action.
Everything sensitive must assume role-based access.
```

## 16. Technical Guardrails

Use:

```text
TypeScript-first types.
Small modules.
Feature flags.
Data access layer.
Role/permission helpers.
Reusable shells for dashboard pages.
Reusable empty/loading/error states.
Route-level separation for public, student, teacher, and ops surfaces.
```

Avoid:

```text
Business logic embedded in UI components.
Hardcoded user role checks scattered across pages.
Direct Firestore calls from every component.
Duplicate course/user/community types.
One giant dashboard component.
Copying AGPL source into this commercial product without explicit legal acceptance.
```

## 17. Required Output From You

Produce these sections in order:

### A. Executive Product Interpretation

Explain what Skillset is becoming in one clear page.

### B. Reference Extraction Matrix

For each reference:

```text
What to use
Where to use it in Skillset
What to avoid
License/code reuse risk
Implementation priority
```

### C. Recommended Architecture

Decide whether the next stage should continue with Firebase-first or pivot now to PostgreSQL/Supabase/Drizzle. Make a clear recommendation and explain tradeoffs.

### D. Full Data Model

Define entities, key fields, relationships, statuses, and access rules.

### E. Route and Module Plan

Define all public, student, teacher, community, and admin routes.

### F. UI/UX Plan

Define layout rules, navigation, dashboard shells, components, states, and copy direction.

### G. Implementation Roadmap

Split into milestones and micro tasks that Codex CLI can execute.

### H. First 20 Implementation Tickets

Each ticket must include:

```text
Title
Purpose
Files likely touched
Implementation detail
Acceptance criteria
Test/build command
```

### I. Risk Register

Include:

```text
Technical risk
Product risk
Legal/license risk
Payment risk
Security risk
UX risk
Scope risk
```

### J. Files To Request From Founder

List exactly which files the founder should attach if you need more precision.

## 18. Recommended Files For Founder To Attach

Ask the founder to attach:

```text
README.md
package.json
next.config.ts
firebase.json
src/app/layout.tsx
src/app/page.tsx
src/app/globals.css
src/components/site/marketing-hero.tsx
src/components/site/site-nav.tsx
src/components/shared/logo-wordmark.tsx
src/data/brand.ts
src/data/site.ts
src/data/instructors.ts
```

If possible, ask for a zip of:

```text
src/
public/
docs/
```

## 19. Final Decision Bias

When uncertain, choose the option that:

```text
Keeps the current project shippable.
Avoids overbuilding.
Preserves premium design.
Keeps course as the core.
Keeps community connected to learning.
Keeps teacher and student experiences distinct.
Lets missing real-world details be plugged in later.
```

Do not stop with abstract analysis. Produce the plan and the first execution backlog.

## END PROMPT

---

## Notes for the founder

Use this file as the master handoff. If the external AI can accept attachments, send this file plus the recommended files in section 18.

If the external AI gives back a roadmap, the best next local execution step is to convert it into small Codex tasks, one module at a time:

```text
visual cleanup
domain model
seed data
auth shell
student shell
teacher shell
community shell
admin shell
Firebase integration
payments
```
