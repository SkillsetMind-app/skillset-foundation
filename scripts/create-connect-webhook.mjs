/**
 * Creates the Stripe CONNECT webhook endpoint — the one that carries sale events.
 *
 * Why this exists: under direct charges the buyer is charged on the TEACHER's
 * connected account, so Stripe delivers `checkout.session.completed` and friends
 * as Connect events (`connect: true`), NOT to the platform endpoint. With only a
 * platform endpoint configured, a real course sale is never delivered, the
 * enrollment is never written, and the buyer pays for nothing.
 *
 * `src/app/api/webhooks/stripe/route.ts` verifies the signature against BOTH
 * STRIPE_WEBHOOK_SECRET and STRIPE_CONNECT_WEBHOOK_SECRET, so one URL serves both
 * endpoints — the only missing piece is the endpoint plus its signing secret.
 *
 * Idempotent: an existing enabled Connect endpoint on the same URL is reused and
 * its events are patched to match. Stripe only reveals a signing secret at
 * creation time, so a reused endpoint reports `secretAvailable: false` and you
 * must roll the secret in the Dashboard if you lost it.
 *
 * The signing secret is NEVER printed. It is written to the path given by
 * --secret-out (0600 where the platform supports it) for piping into
 * `vercel env add`, and the caller is expected to delete that file.
 *
 * Usage:
 *   node scripts/create-connect-webhook.mjs --secret-out <path> [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Exactly HANDLED_STRIPE_EVENT_TYPES from the webhook route. Anything else is
// acknowledged and ignored, so a wider selection would only add noise; a
// narrower one would silently drop fulfilment.
const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
  "account.updated",
];

// www is required: the apex answers 308 and Stripe does not follow redirects.
const URL_PROD = "https://www.skillsetmind.com/api/webhooks/stripe";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outIdx = args.indexOf("--secret-out");
const secretOut = outIdx >= 0 ? args[outIdx + 1] : null;
if (!secretOut && !dryRun) {
  console.error("ABORT: --secret-out <path> is required (or pass --dry-run)");
  process.exit(1);
}

const envPath = resolve(process.cwd(), ".env.local");
const key = readFileSync(envPath, "utf8")
  .split(/\r?\n/)
  .find((line) => line.startsWith("STRIPE_SECRET_KEY="))
  ?.slice("STRIPE_SECRET_KEY=".length)
  .trim()
  .replace(/^["']|["']$/g, "");
if (!key) {
  console.error("ABORT: STRIPE_SECRET_KEY not found in .env.local");
  process.exit(1);
}

async function stripe(path, { method = "GET", form } = {}) {
  const init = {
    method,
    headers: { Authorization: `Bearer ${key}` },
  };
  if (form) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = form.toString();
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, init);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${method} /${path} -> ${res.status}: ${body?.error?.message}`);
  }
  return body;
}

function eventForm(extra = {}) {
  const form = new URLSearchParams(extra);
  EVENTS.forEach((event, i) => form.append(`enabled_events[${i}]`, event));
  return form;
}

const existing = await stripe("webhook_endpoints?limit=100");
const connect = existing.data.find((e) => e.connect === true && e.url === URL_PROD);
const sameEvents = (a, b) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

let endpoint;
let secretAvailable = false;

// `process.exit` here trips a libuv assertion on Windows while fetch's handles
// are still closing, so the dry-run branch falls through instead of exiting.
if (dryRun) {
  console.log(`dry-run: ${connect ? `would patch ${connect.id}` : "would CREATE a connect endpoint"}`);
  console.log(`url    : ${URL_PROD}`);
  console.log(`events : ${EVENTS.length}`);
} else if (connect) {
  if (sameEvents(connect.enabled_events, EVENTS) && connect.status === "enabled") {
    endpoint = connect;
    console.log("existing connect endpoint already matches — nothing changed");
  } else {
    endpoint = await stripe(`webhook_endpoints/${connect.id}`, {
      method: "POST",
      form: eventForm({ disabled: "false" }),
    });
    console.log("patched the existing connect endpoint");
  }
} else {
  endpoint = await stripe("webhook_endpoints", {
    method: "POST",
    form: eventForm({
      url: URL_PROD,
      connect: "true",
      description: "SkillsetMind — Connect (direct-charge sale events from teacher accounts)",
    }),
  });
  secretAvailable = typeof endpoint.secret === "string" && endpoint.secret.length > 0;
  console.log("CREATED a new connect endpoint");
}

if (!endpoint) process.exitCode = 0;
else {
console.log(`id             : ${endpoint.id}`);
console.log(`livemode       : ${endpoint.livemode}`);
console.log(`status         : ${endpoint.status}`);
console.log(`connect        : ${endpoint.connect}`);
console.log(`events         : ${endpoint.enabled_events.length}`);
console.log(`secretAvailable: ${secretAvailable}`);

if (secretAvailable) {
  // No trailing newline: `vercel env add` would otherwise store it and the
  // signature comparison against the stored secret would fail.
  writeFileSync(secretOut, endpoint.secret, { encoding: "utf8", mode: 0o600 });
  console.log(`secret written : ${secretOut} (len=${endpoint.secret.length}) — DELETE after use`);
} else {
  console.log("secret NOT available (endpoint was reused) — roll it in the Dashboard if unknown");
}
}
