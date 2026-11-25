# STRIPE GO-LIVE CHECKLIST — field by field

> Everything here is up to you (access to the Stripe / Vercel dashboard). The code is already done.
> When you finish each item, mark it `[x]`.

Hosting: **Next.js on Vercel** · Data: **Supabase (Postgres)**
Webhook: Route Handler `src/app/api/webhooks/stripe/route.ts` → `POST /api/webhooks/stripe`
Model: **direct charges** — the charge is created on the teacher's connected account and the
platform's commission comes out as `application_fee_amount` (one-time sale) or `application_fee_percent`
(course subscription) (`src/app/api/payments/checkout/route.ts`).

All the server variables below go in **Vercel → project → Settings → Environment
Variables** (Production, and Preview if you are going to test there). Locally, in `.env.local`.
Never in git, never with the `NEXT_PUBLIC_` prefix. After you change a variable, redeploy
so it takes effect.

---

## 1. API keys (TEST first, then LIVE)

Where: https://dashboard.stripe.com → top right corner, switch **Test mode** ON to get the test keys; OFF for the LIVE ones.
Path: **Developers → API keys**.

| Field in the dashboard | What to copy | Where it goes in our system |
|---|---|---|
| **Publishable key** (`pk_test_...` / `pk_live_...`) | the whole string | the Vercel project environment variable `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (and `.env.local` for dev) |
| **Secret key** (`sk_test_...` / `sk_live_...`) | click **Reveal**, copy it | the Vercel project environment variable `STRIPE_SECRET_KEY` (NOT in git, NOT with `NEXT_PUBLIC_`) |

- [ ] Paste the secret key as **a single line**, with no space in the middle: the code trims spaces and line breaks at the ends, but refuses a key with an invalid character in the middle (`sanitizeStripeSecret`, `src/lib/payments/rules.ts`).
- [ ] The key's mode sets the webhook's mode: with `sk_test_` the webhook ignores LIVE events (it answers 503 so that Stripe delivers them again), and with `sk_live_` it ignores test events.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` must also be set: without it the money routes (checkout, webhook, refunds) fail with a 500 error (`src/lib/supabase/admin.ts`).

## 2. Webhook endpoints

Where: **Developers → Webhooks → + Add endpoint**.

With direct charges, the course sale happens on the teacher's connected account, so
Stripe delivers those events as **Connect** events — they never reach a platform-only
endpoint. There are **two endpoints on the same URL**, each with its own signing secret; the route
checks the signature against both.

| Endpoint | "Listen to" field | Endpoint URL | Signing secret goes in |
|---|---|---|---|
| Platform | Events on your account | `https://www.skillsetmind.com/api/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET` |
| Connect | Events on Connected accounts | `https://www.skillsetmind.com/api/webhooks/stripe` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

> ⚠️ Use the `www`: the domain without `www` answers 308 and Stripe does not follow redirects
> (`scripts/create-connect-webhook.mjs`).

Alternative for the Connect endpoint: `node scripts/create-connect-webhook.mjs --secret-out <arquivo>`
(`<arquivo>` is the file path). It reads `STRIPE_SECRET_KEY` from `.env.local` and creates or adjusts the endpoint with the list below. Only when
it creates a new endpoint does it write the signing secret to the file, without printing it; delete the file afterwards.
If the endpoint already existed, the secret does not come back: get it or generate another one in the dashboard. `--dry-run` only shows what it would do.

Events to subscribe to — the exact list in `HANDLED_STRIPE_EVENT_TYPES` in the route. Any other
event is acknowledged and ignored.

**One-time purchase, refund and dispute:**
- [ ] `checkout.session.completed` — course sale: records the payment, marks the order `paid`, grants access and records the earnings entry. It also confirms the storefront activation fee (a session with the activation `purpose`).
- [ ] `checkout.session.async_payment_succeeded` — same handling as the previous one, for asynchronous payment.
- [ ] `checkout.session.async_payment_failed` — order `failed`.
- [ ] `checkout.session.expired` — order `cancelled`.
- [ ] `payment_intent.payment_failed` — order `failed`.
- [ ] `charge.refunded` — records the refund.
- [ ] `charge.dispute.created` — records the dispute.
- [ ] `charge.dispute.closed` — records the outcome of the dispute.

**Subscription** (recurring course + teacher's plan):
- [ ] `invoice.created` — **Connect endpoint**: writes the exact fee (percentage + fixed amount) on the course subscription's renewal invoice while it is still a draft (`handleCourseSubscriptionInvoiceCreated`). Without it, the renewal charges only the percentage from the first invoice.
- [ ] `customer.subscription.trial_will_end` — **platform endpoint**: the email about the end of the plan's free trial, one per subscription (`handlePlanTrialWillEnd`).
- [ ] `invoice.paid` — fulfillment for the billing cycle (`handleCourseSubscriptionInvoicePaid`).
- [ ] `invoice.payment_failed` — failed charge for the cycle (`handleInvoicePaymentFailed`).
- [ ] `customer.subscription.created` — lifecycle (`handleCourseSubscriptionLifecycle` → fallback `syncSubscriptionFromStripe`).
- [ ] `customer.subscription.updated` — lifecycle, same path.
- [ ] `customer.subscription.deleted` — lifecycle, same path.

**Connected account:**
- [ ] `account.updated` — syncs whether the teacher's account can charge and receive money (`handleConnectedAccountUpdated`).
- [ ] `account.application.deauthorized` — **Connect endpoint**: the teacher disconnected the platform; it marks the account as unable to charge and with no payouts, without deleting the id (`handleConnectedAccountDeauthorized`).

> ⚠️ **Without the subscription events, a subscription CHARGES but access is neither granted nor
> revoked**, and the teacher's paid plan is not applied — someone who paid stays on Free (`.env.example`).

After creating each endpoint:
- Open the endpoint → **Signing secret** → **Reveal** → copy the `whsec_...`
- Save it in the matching Vercel project environment variable (table above) and redeploy.

## 2b. Teacher plans (table of 2026-10-06)

Source of truth: `src/data/plans.ts` (prices) and `src/lib/payments/rules.ts` (commission and fixed fee).

| Plan | Monthly | Yearly | Commission per sale | Price IDs |
|---|---|---|---|---|
| Basic | $5 | $50 | 10% + $0.30 | **create** (lookup `skillset_basic_monthly` / `skillset_basic_yearly`) |
| Starter (Recommended) | $19 | $190 | 4.9% + $0.30 | they already exist |
| Pro | $89 | $890 | 2.9% + $0.30 | they already exist |
| Enterprise (not offered, id `plus`) | $199 | $1990 | 1.9% + $0.30 | the ones from the old Plus |

- [ ] Create the **Skillset Basic** Product with the two recurring USD Prices from the table and paste the `price_...` IDs into `src/data/plans.ts` (today `price_PLACEHOLDER_basic_*`). While there is a placeholder, the Basic card shows "Available soon". You can create it in the dashboard or with `scripts/setup-stripe-billing.mjs`, run with the key loaded from the secrets vault and without `STRIPE_WEBHOOK_URL` (the script only creates Basic, reuses a Price by its lookup key and never prints a secret).
- [ ] Optional: rename the "Skillset Plus" Product to "Skillset Enterprise" in the dashboard (the Price IDs do not change).
- [ ] **A dedicated Customer portal configuration** (Settings → Billing → Customer portal → new configuration, not the default one): cancellation on, "at the end of the period"; plan changes only between the Basic, Starter and Pro Prices (monthly and yearly), without Enterprise. Paste the `bpc_...` into `STRIPE_PORTAL_CONFIGURATION_ID` (`src/data/plans.ts`). While it is a placeholder, "Manage" answers 503 instead of opening the default portal.
- [ ] **Enterprise by admin only:** create the subscription in the dashboard, on the creator's customer (`users.stripe_customer_id`), with the metadata `uid=<uid do criador>` (the creator's uid) and `enterprise_grant=admin`. Without that metadata the webhook grants no plan at all and alerts ops (`stripe.plan.enterprise_not_granted`).
- [ ] Free trial: nothing to set up in the dashboard. The checkout asks for `trial_period_days: 14` and `payment_method_collection: always`; one trial per account (`creator_plan_trials`).

## 3. Stripe Connect (teacher payments)

Where: **Connect → Settings**.
- [ ] Connect turned on for the account (if "Get started" appears, finish the platform onboarding)
- [ ] **Branding**: public name, logo, color — shown on the teacher's onboarding screen
- [ ] **Payout settings**: the payout delay and schedule belong to Stripe, on the connected account. The platform does not hold money and has no release cron: the entry in `payout_ledger` is written already as `settled`, with no release date (`src/app/api/webhooks/stripe/route.ts`).
- [ ] Confirm that Connect is in LIVE mode at cutover time

## 4. Test mode — validation before LIVE

- [ ] With the TEST keys set, run `node --env-file=.env.local scripts/stripe-test-e2e.mjs` (the script does not load `.env.local` by itself; without `--env-file` it only reads what is already exported in the shell). It prints a table of how the amounts are split and, with `STRIPE_SECRET_KEY=sk_test_...`, creates a $100 test Checkout Session to prove the connection to the API.
  - The formulas in that table are a historical copy and do **not** follow the current code — the real values are in `src/lib/payments/rules.ts`.
  - The session the script creates has no order attached. Do not pay it against a test endpoint that points to the app: the route requires `orderId`/`courseId`/`userId` in the metadata, throws an error, and Stripe keeps delivering the event again.
- [ ] Use the test card `4242 4242 4242 4242`, any future date, any CVC/ZIP code
- [ ] Make a real course purchase through the app (in test mode) and check in Supabase: the `orders` table with status `paid`, and `payout_ledger` with `skillset_fee_minor`, `stripe_fee_minor` and `net_amount_minor`.
- [ ] Stripe Dashboard (test) → Webhooks → the deliveries to both endpoints answer 200.

## 5. LIVE cutover (only after item 4 is green)

- [ ] Repeat items 1 and 2 with **Test mode OFF** (keys `sk_live_` / `pk_live_` / the two LIVE webhooks)
- [ ] Update the Vercel project environment variables (Production) and redeploy
- [ ] Confirm that both LIVE endpoints are receiving events (Stripe → Webhooks → latest deliveries with 200)
- [ ] A first real sale of a small amount as a smoke test

---

### Summary of what the code expects from you
| Variable | Where to set it | Where to get it |
|---|---|---|
| `STRIPE_SECRET_KEY` | Vercel project environment variable | Stripe → Developers → API keys → Secret key |
| `STRIPE_WEBHOOK_SECRET` | Vercel project environment variable | Stripe → Webhooks → platform endpoint → Signing secret |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Vercel project environment variable | Stripe → Webhooks → Connect endpoint → Signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Vercel project environment variable + `.env.local` | Stripe → Developers → API keys → Publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel project environment variable | Supabase dashboard (the `service_role` key) |
| `SKILLSET_APP_URL` (optional) | Vercel project environment variable | the default is the canonical `SITE_URL` (https://www.skillsetmind.com) |
| `STRIPE_CONNECT_APPLICATION_ID` (optional) | Vercel project environment variable | Stripe → Settings → Connect → Onboarding options → OAuth → `client_id` (`ca_...`), in the SAME mode as `STRIPE_SECRET_KEY` (live with live, test with test); before turning it on, check on a course subscription created by our checkout that the `application` field carries this same id. With it set, a new course subscription on a connected account only counts if it was created by our checkout (`subscription.application`). Without it, nothing changes. |
