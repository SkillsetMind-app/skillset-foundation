# Niche pivot + design alignment — Skillset

> **Date:** 2026-06-28 · **Author:** autonomous session (Claude) · **Status:** Phase 1 executing
> **Branch:** `feat/niche-comms-and-design-alignment`
> **Trigger:** Founder direction — (1) deepen positioning for psychologists, therapists,
> coaches, and human-development mentors; (2) take inspiration from Teachable / LearnWorlds /
> Kajabi / Thinkific but do it differently; (3) adapt to the new Claude Design project
> `f23171e7-26f7-4363-ba9b-a047dd4f2cb3` (`index.html`).

---

## 0. The single most important finding

The new Claude Design project is **not a new visual direction**. Its `tokens.css`
header states verbatim: *"Mirrors src/app/globals.css in skillset-foundation."* A token
diff confirms it — identical navy `#1a365d`, identical red `#b22234`, identical
Manrope + Cormorant Garamond type. **There is no brand/identity migration to do.**

`index.html` in that project is a **React-UMD prototype of the whole platform** (Sidebar +
Topbar + Discover, CourseDetail, Classroom, Studio, Builder, Paths, Community, Credentials,
Pricing, Payouts, Settings, Onboarding, Auth…), used as a design reference — **not** a
marketing landing page to port literally. A separate `membros/` folder holds the
members-area design (PT-BR sample: *"Atelier de Marca"*).

**Consequence:** "adapt to the new design" decomposes into two real workstreams:
1. **Communication** — deepen the helping-professions positioning (design-independent,
   safe, high-value → done first, this session).
2. **Surface parity** — audit live screens against the prototype and close specific
   visual/UX gaps (needs the dev server + screen-by-screen comparison → supervised phases).

Anything beyond those two is invention and is explicitly out of scope.

---

## 1. Reference analysis — borrow vs. avoid

| Platform | What it does well (borrow) | What to avoid for our niche |
|----------|----------------------------|------------------------------|
| **Kajabi** | Premium dark hero, founder portrait, single strong claim, $-proof | *"turn what you know into what you earn"* — money-forward. Helping professionals are repelled by being sold "income." |
| **Thinkific** | Warm editorial palette (cream/burgundy), serif headings, "Powering the world's top learning businesses" — credible + human | Slightly corporate; we go warmer/more personal. |
| **LearnWorlds** | Feature clarity, product mockups, "built for learning businesses", AI angle | Feature-dense to the point of cold; we lead with people, not feature lists. |
| **Teachable** | Clean "education business" framing, structured sections | Busy/generic; weak point of view. |

**The differentiator.** All four sell a *generic* "course business." For
psychologists/therapists/coaches/mentors the emotional driver is **not** earning — it is
*extending impact beyond the one-to-one room, ethically, without becoming a marketer or a
sysadmin.* Payment is reframed from headline to **fairness/trust** (the Skillset Promise
already does this — fee-lock, data portability, one-click cancel). We keep Cormorant's
editorial warmth, keep the premium navy, and let the **copy** carry the niche.

---

## 2. Positioning

**Audience:** licensed psychologists, therapists, and personal-development / human-development
coaches & mentors who already have a method and a 1:1 practice, and want to reach more people
without building a website, wiring tools, or running payments.

**One-line promise:** *Your knowledge changes lives. Now let it reach thousands.* (already live)

**Message pillars (the register, drawn from the prototype's own vocabulary):**
- **Reach, not "income"** — programs that scale your method past the appointment book.
- **Care that continues** — private course community, live sessions, drip — the client
  relationship doesn't end at checkout.
- **Serious & verifiable** — reviewed programs, verifiable certificates: trust signals that
  matter to a regulated, ethics-bound audience.
- **We run the plumbing** — checkout, classroom, payouts. You teach.
- **Fair by contract** — the Skillset Promise (fees locked, data portable, cancel anytime).

**Voice:** warm, plain, unhurried. Calm authority over hype. No growth-bro verbs
("crush", "scale your income", "monetize"). Yes to "reach", "method", "program", "members",
"practice", "presence".

**Truthfulness constraint (Constitution Art. IV — No Invention):** copy may only reframe
real, shipped capabilities. No invented features, numbers, or testimonials.

---

## 3. Phased roadmap

### Phase 1 — Communication refresh (THIS SESSION, autonomous, verifiable)
Reframe the two generic/money-forward marketing sections; leave already-niched sections
(hero, ForCreatorsBand) and the Promise band intact.
- `how-it-works-strip.tsx`: kill *"From idea to income"* / *"Sell globally"*; reframe to
  reach/impact while keeping every payout fact truthful.
- `capabilities-grid.tsx`: reframe the headline and the community description toward
  programs / members / continued care.
- **Acceptance:** homepage renders with no console errors; refreshed copy reads in the niche
  voice; no feature claim is invented; screenshot captured. Local commit on the branch.

### Phase 2 — Surface parity audit (supervised)
Run the dev server. Walk each live screen (`/teach/*`, `/learn/*`, account, auth, onboarding)
against the prototype's matching screen. Produce a gap list (visual/UX deltas only — tokens
already match). Triage by effort/impact. **No blind porting.**
- **Acceptance:** a written gap list with before/after screenshots; founder picks what ships.

### Phase 3 — Members area (supervised; ties to existing decision)
Reconcile the prototype's `membros/*` with the decided members-area architecture
(`docs/plans/2026-06-23-members-area-architecture.md`: instructor-as-tenant + separate
surfaces, ~70% already built — augment, don't replace). The prototype is the visual target
for the classroom/lesson/community surfaces.
- **Acceptance:** members-area screens match the prototype's classroom/lesson/community look,
  reusing the existing platform shell.

### Phase 4 — Launch-readiness reconciliation
Fold this into the open launch blockers (`docs/plans/2026-06-23-launch-readiness.md`) and the
deferred paywall leak (memory: `skillset-paywall-leak-deferred`). Niche copy must not ship
ahead of the security fix on public content.

---

## 4. Blockers & risks

- **Design auth is session-bound.** `DesignSync` works now (auth propagated), but in a fresh
  headless/cron run it may need `/design-login` again. Read the project files early if needed.
- **Language split.** Live site is English ("Skillset USA"); the `membros/` prototype is
  PT-BR. Keep the live site English; import register, not language. Confirm with founder if a
  PT-BR market is intended.
- **Don't outrun the paywall fix.** Public-content security fix is still open; coordinate.
- **Scope discipline.** The autonomous mandate is broad, but porting 20 prototype screens
  unsupervised would be a large unverifiable diff. Phases 2–3 are deliberately gated on the
  dev server + founder review.

---

## 5. Done this session

- Verified design/token parity (no identity migration needed).
- Reference + positioning analysis (above).
- Phase 1 copy refresh, verified in the dev server, committed on the branch (no push).
