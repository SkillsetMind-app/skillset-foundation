# SkillsetMind

SkillsetMind is an online course platform for psychologists, coaches and
personal-development professionals. People who teach build and sell their
courses; people who learn buy and watch them. It all happens on the same site
(https://www.skillsetmind.com).

This repository holds the code for the whole site. It is **public**: never put a
key, a password, customer data or company strategy here.

## The 4 areas of the site

| Area | For whom | Where the code lives |
|---|---|---|
| Visitor | People who have not signed in yet: home page, course catalog, each teacher's page, pricing, help, terms | `src/app/page.tsx`, `src/app/courses`, `src/app/instructors`, `src/app/legal` |
| Learner | People who bought a course: classroom, community, certificates, messages | `src/app/learn` |
| Teacher | People who sell: course creation, storefront, sales, learners, coupons, reports | `src/app/teach` |
| Operations | The platform staff: users, roles, queue of pending items | `src/app/ops` |

Each person's account (profile, security, plans, payments) lives in
`src/app/account` and serves all four areas. The full map is in
`docs/ARCHITECTURE.md`.

## The main pieces

- **Next.js** — the site's "engine": it builds the pages and runs the server routes (the addresses the site calls behind the scenes, in `src/app/api`).
- **Supabase** — holds the database (Postgres, where courses, learners and orders live) and handles sign-in.
- **Stripe Connect** — takes the payments. It uses direct charges: the money from a sale goes straight into the teacher's own Stripe account.
- **Bunny** — hosts and streams the lesson videos (Bunny Stream).
- **Vercel** — hosts the site: it takes the code from GitHub, builds it and publishes it.
- **GitHub Actions** — robots that check every change automatically before it goes in.

## How to run it on your computer

You need Node.js (the program that runs JavaScript outside the browser) at the
version in the `.nvmrc` file, and access to a test Supabase project.

1. Install the dependencies (the libraries the project uses), exactly as CI does: `npm ci`
2. Copy `.env.example` to `.env.local` and fill in the values, using test values. The `.env.local` file
   never goes into git. The most important names:
   - database and sign-in: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - payments: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`
   - video: `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_TOKEN_KEY`, `NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID`
   - email: `RESEND_API_KEY`
   - scheduled jobs: `CRON_SECRET`

   The full list, with what each one does, is in `.env.example` itself.
   Rule: a secret value **never** gets the `NEXT_PUBLIC_` prefix (that prefix
   sends the value to the browser of every visitor).
3. Start the site: `npm run dev` and open http://localhost:3000.

Check commands (the same ones the robot runs):

| Command | What it does |
|---|---|
| `npm run lint` | looks for style errors and careless mistakes in the code |
| `npx tsc --noEmit` | checks the types (whether each piece of data has the expected shape) |
| `npm test` | runs the automated tests (Vitest) |
| `npm run build` | builds the site the way production does |
| `npm run test:db` | runs the database security tests on a throwaway database (see `scripts/build-test-db.sh`; never point it at production) |

On a machine with little memory, run **one test file at a time**:
`npx vitest run src/app/documentation-paths.test.ts --pool=forks --maxWorkers=1`.

## How a change reaches the site

1. **Draft:** create a branch (a parallel copy of the code) from `main`. Never work directly on `main`.
2. **Save:** make commits (each commit is a "save" with a description of what changed).
3. **Review request:** open a pull request (PR), the request to merge the branch into `main`.
4. **Review:** a person reads the change. The PR gatekeeper ("porteiro", an AI that reads the diff looking for security holes) posts a score on the PR; it warns, but it does not block.
5. **Automated checks:** GitHub only allows the merge if these 5 checks pass:
   - `Lint, typecheck, test, build` — style, types, tests and build (`.github/workflows/ci.yml`);
   - `RLS smoke tests (banco efêmero)` — tests the database access rules on a throwaway database (`.github/workflows/ci.yml`);
   - `Semgrep SAST` — looks for unsafe code patterns (`.github/workflows/security.yml`);
   - `TruffleHog secrets scan` — looks for a leaked key or password in the code (`.github/workflows/security.yml`);
   - `npm audit (high+)` — looks for libraries with a known serious security flaw (`.github/workflows/security.yml`).

   Vercel also builds a preview of the site for each PR.
6. **Merge:** once everything is green, the PR is merged into `main`.
7. **Publish:** Vercel notices the change on `main` and publishes it to production on its own.

A database change (a migration) is the exception: it is not applied on its own.
It is applied by hand, never by merging. See "Database" in `docs/ARCHITECTURE.md`.

## Where the documentation is

- `README.md` — this file: what the product is and how to work on it.
- `docs/ONBOARDING.md` — the entry guide for a new development team: access, environment, workflow, conventions, migrations and what not to do.
- `docs/ARCHITECTURE.md` — the system map: where each part lives and how the parts connect.
- `docs/README.md` — an index of everything in `docs/`.
- `AGENTS.md` — rules that have already caused defects in production; required reading before you touch a screen.
- `STRIPE_CHECKLIST.md` — step-by-step Stripe setup.

The test `src/app/documentation-paths.test.ts` checks that every path cited
between backticks in this README, in `docs/ARCHITECTURE.md`, in `docs/README.md` and in
`docs/ONBOARDING.md` really exists. If you move a file, update the document at the same time.
