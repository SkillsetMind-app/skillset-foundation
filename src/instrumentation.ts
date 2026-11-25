import type { Instrumentation } from "next";

import { keepAliveUntil, sendOpsAlert } from "@/lib/ops/alert";

// An error in checkout, in a lesson or at login only showed up in the Vercel log, which
// nobody reads. This Next hook (onRequestError) receives every request
// error on the server and notifies the ops Telegram.
//
// Next can call this hook in two ways, and the send has to survive both:
//  - AWAITED: in the route handler catch, in the page's outer catch and in the
//    proxy, after leaving the request scope. There after() throws; and
//    Next waits for the hook, so the `await` holds the invocation until the notice is sent.
//  - DISCARDED: in rendering errors (RSC/SSR) and in server actions the
//    hook enters React's onError, which calls it and THROWS AWAY the promise. There
//    a lone `await` becomes a fetch nobody waits for, and the instance freezes
//    before it goes out.
// So the send starts only once, the SAME promise goes to after() (or
// to the platform's waitUntil, outside the scope) and only then is awaited.
// sendOpsAlert has a 4 s cap and never throws.
//
// Next already logs the whole error before calling the hook, so
// there is no console.error here.

// Next flow errors, not failures: notFound()/forbidden()/unauthorized()
// and redirect() travel as an exception with `digest`.
const CONTROL_FLOW_DIGESTS = ["NEXT_REDIRECT", "NEXT_HTTP_ERROR_FALLBACK", "NEXT_NOT_FOUND"];

function digestOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const { digest } = error as { digest: unknown };
    return typeof digest === "string" ? digest : null;
  }
  return null;
}

function isExpected(error: unknown): boolean {
  const digest = digestOf(error);
  if (digest && CONTROL_FLOW_DIGESTS.some((code) => digest.startsWith(code))) {
    return true;
  }
  // Client that closed the connection midway: not a platform defect.
  return (
    error instanceof Error
    && (error.name === "AbortError" || (error as { code?: unknown }).code === "ECONNRESET")
  );
}

// 32-bit FNV-1a: groups identical errors without sending the text (the message may
// carry personal data) and without node:crypto, which the edge runtime does not have.
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// One notice per route every 5 minutes, per instance. Per ROUTE, not per
// event: a harmless recurring error on one route cannot hide the one from
// checkout. The slot is reserved before the send (an error that comes back to this hook
// on the same route stops here) and shortened to 60 s if the relay did not confirm.
const THROTTLE_MS = 5 * 60 * 1000;
const LOST_SEND_RETRY_MS = 60 * 1000;
const MAX_ROUTES = 200;
const lastSentAt = new Map<string, number>();

function shouldSend(key: string, now: number): boolean {
  const previous = lastSentAt.get(key);
  if (previous !== undefined && now - previous < THROTTLE_MS) {
    return false;
  }
  // delete + set keeps the Map in order of use: the first one is the oldest.
  lastSentAt.delete(key);
  lastSentAt.set(key, now);
  if (lastSentAt.size > MAX_ROUTES) {
    const oldest = lastSentAt.keys().next().value;
    if (oldest !== undefined) {
      lastSentAt.delete(oldest);
    }
  }
  return true;
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (isExpected(error)) {
    return;
  }

  const route = context.routePath.split("?")[0];
  const key = `app.server_error:${route}`;
  const reservedAt = Date.now();
  if (!shouldSend(key, reservedAt)) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const pending = sendOpsAlert({
    event: "app.server_error",
    // alert.ts only accepts "warn" | "critical". No status in the text: an error
    // caught by error.tsx, or thrown in a Suspense after the shell, goes out with 200.
    severity: "critical",
    summary: `Server error on ${route} (${context.routeType}).`,
    // Only the route pattern, the type, the method, the error name and a
    // fingerprint. Never the URL with query, headers, cookies, body, ids,
    // emails or the whole message.
    context: {
      route,
      routeType: context.routeType,
      method: request.method,
      errorName: error instanceof Error ? error.name : typeof error,
      fingerprint: digestOf(error) ?? shortHash(message),
    },
  });

  // The same promise lives until the relay answers even when nobody awaits
  // this hook (React's onError). keepAliveUntil never throws.
  keepAliveUntil(pending);

  const delivered = await pending;
  // A send the relay did not confirm cannot silence the route for 5 minutes, but
  // also cannot release the route right away: a relay that delivers to Telegram and
  // takes more than 4 s to answer reports a "failure" with the message delivered, and a
  // broken route would alert every few seconds. The slot shortens to 60 s,
  // if no newer send took it: in the worst case, 1 notice per minute per
  // route per instance, and a lost notice comes back within a minute.
  if (!delivered && lastSentAt.get(key) === reservedAt) {
    lastSentAt.set(key, Date.now() - THROTTLE_MS + LOST_SEND_RETRY_MS);
  }
};
