# How to work in this repository

The entry guide for anyone who will write code for SkillsetMind. Before this, also read
`README.md` (what the product is), `docs/ARCHITECTURE.md` (where each part lives) and
`AGENTS.md` (rules that have already caused defects in production).

## 1. The access you will need

Ask whoever leads the team. Only the names go here; no key value ever goes into the
repository.

| Service | What for |
|---|---|
| GitHub | Read and write the repository, open PRs, see the checks |
| Vercel | See the preview of each PR, the logs and the site's environment variables |
| Supabase | Database, sign-in and files. For day-to-day work, a **test** project; production only for whoever applies migrations |
| Stripe | Payments, always starting in **test mode** |
| Bunny | Video upload and playback (the Bunny Stream library) |
| Resend | Sending the product emails |

Not everyone needs all of them. Someone who only works on screens gets by with GitHub, Vercel and a
test Supabase project.

## 2. Setting up the environment on your computer

1. Install Git and Node.js at the version in the `.nvmrc` file (Node is the program
   that runs JavaScript outside the browser).
2. Download the code:
   `git clone https://github.com/SkillsetMind-app/skillset-foundation.git`
3. Install the dependencies exactly as CI does: `npm ci`.
4. Copy `.env.example` to `.env.local` and fill it in with the **test** values
   the team gives you. The `.env.local` file never goes into git. Never use a production
   key on your machine.
5. Start the site: `npm run dev` and open http://localhost:3000.
6. Check that everything is fine: `npm run lint` and `npx tsc --noEmit`.
7. For the database tests, let CI run them. If you need to run them locally, follow the
   steps of the `rls` job in `.github/workflows/ci.yml`: it starts a throwaway
   database and builds it with `scripts/build-test-db.sh`. Never point these
   tests at production: they write to the database.

## 3. How the work flows

1. **Branch** (a parallel copy of the code) from `main`, named
   `type/subject`: `feat/` for something new, `fix/` for a fix, `perf/`,
   `chore/` for maintenance, `docs/` for documentation. An example from the history
   (named before the repository moved to English): `fix/compra-sem-beco`.
2. Small **commits**, each with a clear description of what changed.
3. A **pull request** against `main`, with a title and description in English: what changes, why,
   and how it was tested.
4. **Review:** a person reads it. The PR gatekeeper ("porteiro", `.github/workflows/porteiro.yml`)
   posts a security score; it warns, it does not block.
5. **The 5 required checks** must turn green: `Lint, typecheck, test,
   build` and `RLS smoke tests (ephemeral database)` (in `.github/workflows/ci.yml`);
   `Semgrep SAST`, `TruffleHog secrets scan` and `npm audit (high+)` (in
   `.github/workflows/security.yml`).
6. **Merge:** the history of `main` uses squash merges (the PR becomes a single commit, with the
   PR number in the title).
7. **Publishing:** Vercel publishes `main` on its own. Each PR gets a preview
   before that.

`main` is protected: it does not accept direct commits, force-pushes, or being deleted.

## 4. Code conventions (checked in the repository)

### Language
- The repository is in **English**: code, comments, test names, documentation,
  commit messages and pull-request titles.
- A comment explains the **why** (the defect it prevents, the business rule); it does not
  repeat what the code says.
- Two exceptions. Migrations that were already applied are never edited, so their old
  Portuguese file names and comments stay, and so does the name of the smoke test that
  pairs with each of them in `supabase/tests`. The Spanish product copy in `src/data/i18n` is product
  text, not a translation leftover.

### Screen text
- Every piece of text the user sees comes from the dictionaries `src/data/i18n/en.json` and
  `src/data/i18n/es.json` (English and Spanish); no sentence is written directly in the component.
- In the browser, use `useTranslation()` from
  `src/components/i18n/i18n-provider.tsx`; on the server, `getServerTranslation()`
  from `src/lib/i18n/server.ts`.
- A new key goes into both languages, with the same placeholders (`{name}`):
  `src/lib/i18n/dictionary-parity.test.ts` blocks any difference.
- Words for regulated professions have their own rule (see `AGENTS.md`);
  `src/data/i18n/regulated-wording.test.ts` blocks whatever slips through.

### Motion
- Every animation lives inside `@media (prefers-reduced-motion: no-preference)`
  in `src/app/globals.css`, so people who asked their system for less motion see
  nothing move.
- Animations only change `transform` and `opacity` (the properties the
  browser can animate without redoing the layout). The only accepted exception is the stroke of an
  icon that draws itself.
- `src/app/onda-d-motion.test.ts` and `src/app/classroom-motion.test.ts` check
  these rules.

### Accessibility
- Visible focus: the global rule in `src/app/globals.css` draws a ring around
  buttons and links focused with the keyboard. Do not hide it with `outline-none` without putting
  another indicator in its place.
- A button is a `button`, a link is an `a`. An icon without text gets an `aria-label`; a menu that opens
  and closes uses `aria-expanded`; a notice that appears on its own uses `aria-live`.
- Overlay dialogs trap the focus inside them
  (`src/lib/a11y/use-modal-focus.ts`) and fit on the screen (full rule in
  `AGENTS.md`; `src/app/dialog-viewport-fit.test.tsx` checks it).
- Headings in order, without skipping a level (`src/app/learn/heading-levels.test.tsx`).
- A form field uses a font of at least 16px, otherwise the iPhone zooms in
  (`src/app/mobile-field-zoom.test.ts`).

### Tests
- Vitest, with `*.test.ts` or `*.test.tsx` files next to the code, inside
  `src`.
- Changed a rule? Leave a test that fails if the rule breaks again.
- On a machine with little memory, run **one file per process**:
  `npx vitest run caminho/do/arquivo.test.ts --pool=forks --maxWorkers=1`
  (`caminho/do/arquivo` means path/to/file). CI runs the whole suite.
- The tests have no real browser, so they cannot see layout. Whatever must
  fit on the screen is checked in a real browser.

## 5. Database migrations, safely

A migration is a SQL file that changes the structure of the database.

**How to write one:**
- A new file in `supabase/migrations`, named `AAAAMMDDHHMMSS_assunto.sql`
  (year, month, day, hour, minute and second, then the subject; the date in the name sets the order). Start with a comment that explains the why.
- **Never edit a migration that has already been applied.** To change a function, create
  another file with `create or replace`; the most recent definition wins.
- A new table turns on RLS (the database rule that decides who reads and changes each
  row) and gets its policies in the same file.
- A `security definer` function (one that runs with its owner's permissions, above RLS) gets
  `set search_path = public, pg_temp` and takes away access from whoever must not call it
  (`revoke execute ... from public, anon, authenticated`).
- Write the smoke test (a quick check that the basics hold) with the same name and the ending `_smoke.sql` in
  `supabase/tests`, as almost every recent migration has, and always when the
  change touches access or money. It runs in the check
  `RLS smoke tests (ephemeral database)`.
- Changed the shape of a table? Update `src/lib/supabase/database.types.ts`.
- Guards that read the SQL on every PR: `src/lib/supabase/rls-policy-guards.test.ts`
  and `src/lib/supabase/rpc-definition-guards.test.ts`.

**How to apply one:**
- Merging the PR does **not** change the database. The migration is applied by hand to production
  by whoever has that access, through the Supabase dashboard or from the command line.
- The team marks the PRs that carry a migration in the title (the history uses the
  prefix `[PC aplica migration]`, a Portuguese label meaning the migration must be applied by hand), so nobody forgets to apply it.
- Apply it first to a test project, check it, then production. Do it inside a
  transaction (`begin` ... `commit`), so that an error halfway through does not leave the database
  half changed.

## 6. Where the design system is

- `docs/design-system/skillset-design-system/` — colors, typography, buttons,
  cards and screen kits, with HTML previews.
- `src/app/globals.css` — the real values (the `--color-*` variables,
  spacing, motion) that the site uses.
- `src/components/ui` — the basic pieces that are already built; use them before creating another one.
- `docs/design-v2/DESIGN-SYSTEM-V2.md` — the specification of the second version.
- `src/data/brand.ts` — name, brand and logos.

## 7. What not to do

- **Secrets in the code:** never. A server key does not get the
  `NEXT_PUBLIC_` prefix (that prefix sends the value to the browser of every
  visitor). The TruffleHog check looks for leaked keys, including in the history.
- **`.env` files:** never read one aloud, paste it in a chat, print it in a log or
  commit a `.env` with a real value. The `.env.local` file is ignored by git; the
  `.env.production` file only holds public values.
- **Force-pushing to `main`** or committing directly to it: no.
- **Editing a migration that was already applied:** no; write another one.
- **Running database tests against production:** no.
- **Plans, session notes, business strategy, investor material or
  security findings in the repository:** no. It is public.

## 8. I deleted a product by mistake

**In short:** within about a day of the delete, cancel the cleanup
(`status = 'cancelled'` on the `course_deletions` row) and the product's files
and videos stay. Its database rows (lessons, sales page, community posts,
sessions) are already gone and only come back from the database backup
(`docs/BACKUP.md`), recreated with the same course id.

When a product with no buyer is deleted, its rows in the database disappear
at once: the course, the lessons, the lesson text, the sales page, the community
posts, the live sessions, the invitations and the wishlists. The files
(cover, materials, sales page images) and the Bunny videos go into a
queue, the `course_deletions` table, and only start being removed about a day later,
every hour and in batches (`src/app/api/cron/course-cleanup/route.ts`). That
day exists to give you time to stop it.

**1. Stop the cleanup, as soon as possible.** Only someone with administrator access to the
database can do this (the table is closed to the app). In the Supabase dashboard, in SQL Editor,
with the product id:

```sql
update public.course_deletions
   set status = 'cancelled', finished_at = now(),
       last_error = 'cancelled by staff: product deleted by mistake'
 where course_id = '<product id>' and status in ('pending', 'failed');
-- Expected: 1 row. 0 rows = wrong id, or the cleanup already finished (done).
select status, attempts, requested_at, last_progress_at, result
  from public.course_deletions where course_id = '<product id>';
```

With `cancelled`, the job no longer lists files for this product and does not delete
any of its videos, not even in a run that is already going: it asks the database
before each video. Files from a batch that was already being removed in that minute
may be gone.

**2. What comes back and what does not.**
- **Comes back, if the cleanup was stopped before it started** (`last_progress_at`
  empty): the files in the product's `courses/<id>/` Storage folder and the videos on Bunny.
- **Does not come back on its own:** the database rows. They only come back from the backup
  (`docs/BACKUP.md`), by recreating the course with the SAME id and the rows that belonged
  to it. With the same id, the file folder and the video receipts become valid
  again. A new product, with another id, cannot see the old files.
  Keep the course's original `created_at`: if it is ever deleted again,
  the cleanup only deletes files created after that date.
- **Never comes back:** whatever the cleanup has already deleted (`done`, or
  `last_progress_at` filled in). Bunny has no trash bin. The Supabase backup
  does not keep the Storage files; only the repository's backup (30 days) has
  a copy of them.

The app never accepts that id again: no account (not even the course's owner) can recreate a course
with an id that has already been through the queue, in any status. The staff recreates it through the
SQL Editor (or with the service role), preferably after the `cancelled`.

**A cleanup failed 5 times** (`status = 'failed'`, and the staff gets a
`course_cleanup_failed` alert): read `last_error`, fix the cause and put it back in the
queue with `status = 'pending', attempts = 0, stalled_runs = 0, last_error = null`.
