# SkillsetMind architecture

The map of the system: where each part lives and how the parts talk to each other. Written for
people who have never programmed and for people who have just arrived in the code. Every path between
backticks really exists; the test `src/app/documentacao-caminhos.test.ts` fails
if one of them stops existing.

## The view from above

```
Visitor's browser
   │
   ▼
Vercel (hosting) ── runs Next.js (src/app)
   │        │
   │        ├── Supabase: database, sign-in and files
   │        ├── Stripe: payments (straight into the teacher's account)
   │        ├── Bunny: lesson videos
   │        └── Resend: emails
   ▼
GitHub Actions: checks on every change, hourly jobs, backup
```

## Main folders

| Folder | What it holds |
|---|---|
| `src/app` | The pages (each folder becomes an address on the site) and the server routes in `src/app/api` |
| `src/components` | The reusable screen pieces (buttons, cards, menus), grouped by area |
| `src/lib` | The code that talks to the outside world: database, Stripe, Bunny, email |
| `src/domain` | The business rules as pure code, with no database and no internet (which makes them easy to test) |
| `src/data` | Fixed content: translated text (English and Spanish), plans, help questions |
| `supabase` | The database structure and its security tests |
| `scripts` | Command-line tools: backup, database tests, Stripe setup |
| `.github` | The GitHub Actions robots |

## Pages by area (`src/app`)

**Visitor** (no sign-in needed):
`src/app/page.tsx` (home), `src/app/courses` (catalog and each course's page),
`src/app/instructors` (each teacher's public page), `src/app/pricing`,
`src/app/how-it-works`, `src/app/for-creators`, `src/app/fees-and-payouts`,
`src/app/help`, `src/app/support`, `src/app/promise`, `src/app/trust`,
`src/app/refund-policy`, `src/app/legal` (terms and privacy) and
`src/app/verify` (anyone can check whether a certificate is genuine).

**Sign-in and sign-up:** `src/app/login`, `src/app/signup`,
`src/app/forgot-password`, `src/app/reset-password`, `src/app/auth` (sign-in
form and the return from email links), `src/app/onboarding`, `src/app/welcome` and
`src/app/invitations` (invitations).

**Learner** — `src/app/learn`: the classroom for each course
(`src/app/learn/courses/[slug]`), community, certificates, events, messages and
wishlist. Paying for a course starts at
`src/app/courses/[slug]/checkout`.

**Teacher** — `src/app/teach`: course builder (`src/app/teach/builder`),
storefront (`src/app/teach/storefront`), sales, learners, coupons, subscriptions,
refunds, reports, staff, media and verification.

**Operations** — `src/app/ops`: the platform staff's dashboard and the record for each
user (`src/app/ops/users`). It only opens for someone with an operations role who signed in
with the second factor (see `docs/first-admin-setup.md`).

**Account** — `src/app/account`: profile, security, email, notifications, plan and
payments. It serves all four areas.

**Before everything** — `src/proxy.ts` runs on every request, before the page: it decides
where a teacher's own domain goes, applies the content security policy
(CSP, the list of what the browser is allowed to load) and filters countries on the
sensitive doors.

## Screen pieces by area (`src/components`)

| Folder | Area |
|---|---|
| `src/components/site` | Visitor: header, footer, home page sections |
| `src/components/courses`, `src/components/instructors` | Catalog and public pages |
| `src/components/auth` | Sign-in, sign-up, CAPTCHA |
| `src/components/learn` | Learner: classroom, lesson list, community |
| `src/components/teacher` | Teacher: course builder, sales, storefront, AI advisor |
| `src/components/admin` | Operations: dashboard, roles, invitations |
| `src/components/account` | Account: plan, security, second factor |
| `src/components/platform` | The frame of the signed-in areas: side menu, top bar |
| `src/components/ui`, `src/components/shared` | Basic pieces used everywhere |

## Data layer

- `src/lib/supabase/client.ts` creates the connection to Supabase **in the browser**;
  `src/lib/supabase/server.ts`, **on the server** with the session of whoever is signed in;
  `src/lib/supabase/admin.ts`, on the server with the service key (which bypasses
  the access rules — only for payments, webhooks and scheduled jobs).
- `src/lib/data` gathers the functions that read and write each subject (orders,
  enrollments, courses, notifications...). The ones that only run on the server live in
  `src/lib/data/server`.
- `src/domain` holds the pure rules: who can see which lesson, how much it costs, when
  a lesson unlocks. Screens and routes call these rules instead of repeating the
  logic.
- `src/lib/supabase/database.types.ts` describes the shape of each table in the
  database, so the code knows what data to expect.

## Database (`supabase`)

- `supabase/migrations` — each migration is a SQL file that changes the structure of the
  database (creates a table, a column, a rule). The date in the name sets the order.
- **RLS** (row-level security) is a rule inside the
  database itself that decides, record by record, who can read or change each
  row. That way, even if a screen gets it wrong, the database does not hand one
  teacher's course to another.
- `supabase/tests` — smoke tests (quick checks that the basics hold) for the RLS rules. CI builds a
  throwaway database with `scripts/build-test-db.sh` and runs the tests with
  `scripts/run-supabase-tests.mjs`.
- `supabase/schema/remote_schema_2026-07-21.sql` — a full snapshot of the database on
  2026-07-21. The migrations older than that snapshot do not replay from scratch; the
  reproducible truth is "snapshot + later migrations" (the reason is in
  `supabase/SCHEMA_BASELINE_REPORT.md`).
- `supabase/templates` — the templates for the sign-in emails (confirmation, password
  change, invitation).
- **How a migration reaches production:** nothing applies it automatically. Merging
  the PR does not change the database: someone with access applies the file by hand to the production
  database (through the Supabase dashboard or from the command line).

## Sign-in and roles

Sign-in is handled by Supabase Auth (`src/lib/auth/supabase-auth.ts`). Each user has
a list of roles (`student`, `teacher`, `admin`, `ops`, `support`,
`moderator`); what each role can do is in `src/lib/permissions/index.ts`,
and the database checks again on its own. Staff roles only count with the
second factor (a code from an authenticator app). Other defenses: a leaked password is
refused (`src/app/api/auth/pwned-check`), a CAPTCHA (the "are you human?" test)
on the sign-in screens (`src/components/auth/turnstile-widget.tsx`) and a limit on attempts
(`src/lib/supabase/rate-limit.ts`).

## Payments and webhooks

- **Direct charge model:** the buyer pays straight into the teacher's Stripe
  account. The teacher is the official seller (the merchant of record); the platform's commission comes out
  automatically in the charge itself, and the platform never holds anyone
  else's money. The course checkout is in `src/app/api/payments/checkout/route.ts`.
- **The teacher's Stripe account:** creation, onboarding and updates in
  `src/app/api/payments/connect`.
- **The teacher's plan** (monthly subscription): `src/app/api/payments/billing`.
  The plans and what each one unlocks are in `src/data/plans.ts` and
  `src/domain/entitlements.ts`. The storefront activation charge
  (`src/app/api/payments/activation`) only happens when the
  `require_activation_fee` setting is turned on in the database.
- **Refunds:** `src/app/api/payments/refunds`. **Cancelling a course subscription:**
  `src/app/api/payments/course-subscription`.
- **Fees and amount rules:** `src/lib/payments/rules.ts`.
- **Webhook** (the notice Stripe sends to the site when something happens: a sale
  paid, a refund, a dispute): `src/app/api/webhooks/stripe/route.ts`. It checks
  the notice's signature against two secrets (platform events and events from the
  teachers' accounts) and only then grants access to the course. Step-by-step
  setup: `STRIPE_CHECKLIST.md` at the root.

## Video

- The videos live on **Bunny Stream** (a video hosting service).
- Upload: the server creates the video and returns a short-lived signature
  (`src/app/api/teach/video/create/route.ts`); the teacher's browser sends the
  file straight to Bunny in chunks (the TUS protocol), which resume where they stopped if the
  connection drops. Progress is checked at `src/app/api/teach/video/status`.
- Playback: before playing, `src/app/api/courses/video-token/route.ts` checks whether
  the person has the right to the lesson and returns a signed link that expires.
- The code that talks to Bunny is in `src/lib/bunny/server.ts`.
- A deleted product loses its Bunny videos and its Storage files starting
  one day later, every hour and in batches: the `course_deletions` queue is created
  together with the DELETE, and the scheduled job `src/app/api/cron/course-cleanup` deletes
  only the `courses/<id>/` folder and only videos with a receipt from that course; a file or
  video that another live row still cites stays. A product with a buyer is archived, never
  deleted. Deleted the wrong product: see the section "I deleted a product by mistake" in
  `docs/ONBOARDING.md`.
- Covers and thumbnails live in Supabase's file storage, in a
  public space; course support materials live in a private space, read through temporary
  links (`src/lib/data/course-assets.ts`).

## Email and notifications

- **Sign-in emails** (confirm sign-up, change password): sent by
  Supabase with the templates in `supabase/templates`, generated by
  `scripts/build-email-templates.mjs`.
- **Product emails** through Resend (an email sending service): access
  granted after a purchase (`src/lib/payments/server/purchase-access-email.ts`),
  a reminder to confirm the email (`src/app/api/cron/confirmation-reminder`) and a
  notification digest (`src/app/api/cron/notification-digest`).
- **Notifications inside the site** (the bell): `src/lib/data/notifications.ts`; they arrive right
  away, without reloading the page.
- **Alerts for the staff:** `src/lib/ops/alert.ts` sends the alert to a private
  channel (the address lives in an environment variable, never in the code).

## Scheduled jobs

| What | When | Where it is scheduled |
|---|---|---|
| Reindex the AI advisor's knowledge base (`src/app/api/cron/advisor-knowledge`) | every day, 07:00 UTC | `vercel.json` |
| Payments stuck in Stripe, the staff's queue of pending items and whether the site is up (`src/app/api/cron/stripe-attention`, `src/app/api/cron/ops-inbox`) | every hour | `.github/workflows/stripe-attention.yml` |
| Reminder to confirm the email and notification digest | every hour | `.github/workflows/stripe-attention.yml` |
| Delete the files and videos of a deleted product, starting one day later (`src/app/api/cron/course-cleanup`); it only rehearses until `COURSE_CLEANUP_LIVE=1` is set on Vercel | every hour | `.github/workflows/stripe-attention.yml` |
| Encrypted backup of the database and the files | every day, 04:10 UTC | `.github/workflows/backup.yml` (details in `docs/BACKUP.md`) |
| Full security scan | every Sunday, 06:00 UTC | `.github/workflows/security.yml` |

The `src/app/api/cron` routes only answer someone who shows the `CRON_SECRET`
(`src/lib/cron/authorized.ts`). The hourly jobs live on GitHub Actions
because the current Vercel plan only schedules once a day.

## AI assistants

- **Public help** (`src/app/api/assistant/route.ts`): answers visitors based
  on the same content as the help page (`src/data/help-faq.ts`).
- **Teacher's advisor** (`src/app/api/teach/advisor/route.ts`): helps people who
  sell, with memory of the conversation. Setup and variables in
  `docs/teacher-advisor-setup.md`.

## Translations

- The site speaks English and Spanish. The text lives in `src/data/i18n/en.json` and
  `src/data/i18n/es.json`; the two must have the same keys and the same
  placeholders (`src/lib/i18n/dictionary-parity.test.ts` checks this).
- The chosen language is stored in a cookie (a small note saved in the browser),
  not in the page address (`src/lib/i18n/config.ts`).
- `src/data/i18n/regulated-wording.test.ts` blocks words for regulated
  professions in the text (full rule in `AGENTS.md`).
- Portuguese was kept for the future in `docs/i18n-archive/pt-br.json`.

## Tests

- **Vitest** (the automated test tool) runs every
  `*.test.ts` or `*.test.tsx` file inside `src`. Command: `npm test`.
- On a machine with little memory, run **one file at a time**, in a single process:
  `npx vitest run caminho/do/arquivo.test.ts --pool=forks --maxWorkers=1` (`caminho/do/arquivo` means path/to/file).
- The tests run without a real browser, so they cannot see layout. Something that
  must "fit on the screen" has to be checked in a real browser (see `AGENTS.md`).
- Database tests: `npm run test:db`, always on a throwaway database.

## Security gates

Every PR goes through these gates before it can go into `main`:

| Gate | What it does | Where |
|---|---|---|
| PR gatekeeper ("porteiro") | An AI reads the diff and looks for logic holes; it posts only the score on the PR (the details go to a private channel, because the repository is public). It warns, it does not block. Its own tests run in the required check | `.github/workflows/porteiro.yml`, `scripts/porteiro.py`, `scripts/test_porteiro.py` |
| Semgrep | Looks for known unsafe code patterns in `src` | `.github/workflows/security.yml` |
| TruffleHog | Looks for a leaked key or password, including in the history | `.github/workflows/security.yml` |
| RLS tests | Prove, on a throwaway database, that the access rules hold | `.github/workflows/ci.yml`, `supabase/tests` |
| npm audit | Blocks a library with a high or critical security flaw | `.github/workflows/security.yml` |

On top of these: Dependabot proposes library updates
(`.github/dependabot.yml`), and tests inside Vitest itself guard the database rules
(`src/lib/supabase/rls-policy-guards.test.ts`,
`src/lib/supabase/rpc-definition-guards.test.ts`) and the repository automation
(`src/app/repo-automation.test.ts`).

## The teacher's own domain

A teacher can connect their own domain to the storefront. The request comes in through
`src/app/api/teach/domains`, the domain is registered on Vercel
(`src/lib/domains`), and `src/proxy.ts` uses `src/domain/host-routing.ts` to
show the right storefront when someone arrives through that address.

## Usage measurement

PostHog (`src/lib/posthog`) and Vercel Analytics record page usage, so we
know what people do on the site. PostHog respects the choice made in the cookie
notice: people who decline are not measured.
