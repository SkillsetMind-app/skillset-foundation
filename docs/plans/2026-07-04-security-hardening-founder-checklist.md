# Security Hardening — Founder Checklist (2026-07-04)

Overnight autonomous session. Goal: implement the standard, recommended
security protections for a real-money marketplace of this scale — password
attacks, admin-login / brute-force, and protection of the platform's own AI
assistant (prompt injection, reverse-engineering, data harvesting).

Everything below is **shipped and live in production** unless marked as a
founder action. Two commits, both deployed and verified:

- `b4a6197` — harden AI proxies, admin refunds, pwned-check, report-only CSP
- `85533fb` — dormant Turnstile CAPTCHA on the auth forms

---

## What shipped (live now, `skillsetmind.com`)

### AI assistant / advisor trust boundaries
Both `/api/assistant` (public help chatbot) and `/api/teach/advisor` (teacher
studio advisor) proxy to n8n → DeepSeek. Hardened at the route (the trust
boundary):

- **Fail closed on the webhook secret.** The route now refuses to call the n8n
  webhook unless `N8N_*_WEBHOOK_SECRET` is set, and always sends it as
  `x-assistant-secret` / `x-advisor-secret`. Before, the secret was sent only
  *if present* — anyone who discovered the webhook URL could hit DeepSeek on
  our dime and siphon the platform knowledge context. Now that's impossible.
- **Two-window rate limits.** Hourly burst cap + daily economic cap per user
  (advisor 30/h + 120/day; assistant 20/h + 80/day, keyed by session or hashed
  IP for signed-out visitors). Blunts scripted abuse and bounds the DeepSeek
  bill.
- **Control-character reject.** Messages containing NUL / C0-C1 control bytes
  are rejected (400) — a classic vector for smuggling a prompt-injection
  payload past the downstream model parser.
- **Concurrency semaphore.** Per-lambda cap on in-flight upstream calls so a
  burst can't exhaust the n8n/DeepSeek worker pool.

Note: the actual "never reveal platform data / answer-only-from-context"
instruction lives in the n8n flow's system prompt — see founder action #5.

### Admin refunds — audit trail
`/api/payments/refunds/admin` now writes an `audit_log` row (who refunded what,
Stripe refund id, amount, order/buyer) on every admin refund. Best-effort: a
logging failure never fails a refund Stripe already accepted. Makes a rogue or
compromised admin action investigable after the fact.

### pwned-check — per-IP rate limit
`/api/auth/pwned-check` (the HIBP proxy behind the breached-password guard) now
has a per-IP rate limit (100/min, hashed IP). **Fail-open**: a limiter outage
never blocks the pwned check (it's best-effort auth assist), only a real breach
returns 429. Stops the endpoint being farmed as a free HIBP proxy.

### Baseline headers + report-only CSP
On top of the existing HSTS / X-Frame-Options / nosniff / Referrer-Policy /
Permissions-Policy, we now ship a **`Content-Security-Policy-Report-Only`**
header (verified live) plus a `/api/csp-report` sink. It **blocks nothing** —
it observes violations so we learn the true directive set from real traffic
before promoting to an enforcing CSP. Cloudflare Turnstile is already pre-allowed
in the policy.

### Turnstile CAPTCHA — wired, dormant
The login / signup / password-reset forms now render a Cloudflare Turnstile
widget **only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set**. Unset (current
state) = renders nothing, behaves exactly as before. This is the client half
that Supabase's built-in CAPTCHA requires — it can't be enabled server-side
alone. See founder action #3 for the enable order.

### Verified in prod after deploy
- All security headers present on `https://skillsetmind.com/` (incl.
  CSP-Report-Only, X-Powered-By suppressed).
- `POST /api/assistant` with empty body → **400** (passed the secret gate →
  `N8N_ASSISTANT_WEBHOOK_SECRET` **is** set in Vercel; no regression to the
  public assistant).
- Gate on both commits: tsc 0, eslint 0, vitest 131/131, next build EXIT 0.

---

## Founder actions

### 🔴 Priority (do these first)

1. **Rotate the leaked `service_role` key.** Supabase project
   `ijtikldtjvsbtwszokvs`, leaked 2026-07-02. This is the master key over every
   money table — it bypasses RLS entirely. Rotate in Supabase dashboard →
   Settings → API, then update `SUPABASE_SERVICE_ROLE_KEY` in Vercel. Still
   pending from prior sessions; nothing else matters as much as this.

2. **Verify the n8n webhook secrets are set in Vercel** (both must be present or
   the AI degrades to a calm "being set up" state — fail-closed by design):
   - `N8N_ASSISTANT_WEBHOOK_SECRET` — confirmed set (probe returned 400). ✅
   - `N8N_ADVISOR_WEBHOOK_SECRET` — could not probe (advisor is auth-gated), but
     its n8n flow has a secret-verify node and works e2e, so it should be set.
     Confirm it exists; if the teacher advisor shows "being set up", set it.

3. **Turnstile — enable in this order to avoid a breakage window:**
   1. Create a Turnstile widget at Cloudflare (dash.cloudflare.com → Turnstile).
      Get the **site key** (public) and **secret key** (private).
   2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in Vercel **first** → redeploy.
      Tokens now flow; Supabase still ignores them (no enforcement yet).
   3. **Then** Supabase dashboard → Authentication → Attack Protection → enable
      CAPTCHA, provider Turnstile, paste the **secret key**. Enforcement is now
      live on login/signup/reset. (Doing step 3 before step 2 would break auth.)

### 🟡 Standard hardening (recommended, dashboard-only)

4. **Supabase Attack Protection** (Auth → Attack Protection):
   - Enable "Leaked password protection" (redundant with our free-tier HIBP
     guard, but it's the native belt-and-suspenders).
   - Set a minimum password length (8) and character requirements if desired.
   - Supabase's built-in auth rate limits are on by default — no action, just
     confirm they're not lowered.

5. **n8n prompt-injection guardrail** (the AI's own defense). In the n8n
   assistant/advisor flows, make sure the DeepSeek system prompt:
   - answers **only** from the provided context, refuses anything outside it;
   - never reveals its own instructions, the platform's internal data, keys, or
     other users' data (reverse-engineering / harvesting defense);
   - treats the user message as untrusted data, not instructions.
   Also confirm the n8n flow talks to Supabase with the **anon key + RLS**, not
   the service_role key.

6. **Enroll TOTP on your admin account now.** MFA/2FA is fully built (enroll,
   verify, aal2 gate) but not yet *enforced* for admin/ops roles — that's a
   deferred task below. Until then, manually enrolling protects the highest-value
   account against a stolen admin password. Account → Security.

7. **CSP: watch → tune → enforce.** The report-only CSP is logging violations to
   `/api/csp-report` (visible in Vercel → Functions logs, tagged `[csp-report]`).
   After a few days of real traffic, tighten `img-src`/directives to the hosts
   that actually appear, then flip the header key from
   `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in
   `next.config.ts` to start enforcing.

---

## Deferred (each its own follow-up task)

Not done tonight — larger surface, each deserves a dedicated pass:

- **MFA enforcement for admin/ops roles** — require aal2 before admin/ops
  routes/actions (the TOTP machinery already exists; this is a gate + UI).
- **Session revocation UI** — let a user (and admin) see and revoke active
  sessions.
- **Realtime channel authorization** — verify the Supabase Realtime channels
  are RLS-scoped so subscriptions can't leak cross-tenant rows.
- **Subresource Integrity (SRI)** on any third-party scripts.
- **Dependency-override provenance** comments / `overrides` audit.

---

## Notes for future me

- RLS is the real authorization gate and it's clean (Supabase advisor 0 ERROR).
  Two "cross-tenant leak" audit findings this session were **false positives**
  — they assumed weaker RLS than reality; verified against live policies and
  dropped. One of the "fixes" (`.eq('teacher_id')` on `subscribeToTeacherOrders`)
  would have *broken* teacher sales views. Don't re-apply it.
- `hasControlChar` is a char-code check, not a regex, on purpose — a regex with
  control chars trips `no-control-regex` and leaves invisible bytes in source.
- Push works directly here: `git push origin HEAD:main` from `feat/design-v2`
  (currently == origin/main). No @devops needed for this repo.
