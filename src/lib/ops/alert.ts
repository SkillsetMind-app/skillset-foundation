import { after } from "next/server";

/**
 * Operational alerts, delivered after the response.
 *
 * Server-side only by construction: OPS_ALERT_WEBHOOK_URL has no NEXT_PUBLIC_
 * prefix, so it is undefined in the browser and every call there is a no-op.
 * No server-only import — the package is not a dependency here, and adding one
 * to state what the env var already enforces is not worth the install.
 *
 * Nothing on the platform could tell anyone that something was wrong: a forged
 * webhook or someone probing the admin routes left a line in a log that nobody
 * reads. This posts a short JSON body to a webhook — an n8n flow that relays it
 * to Telegram — so a real signal reaches a human within seconds.
 *
 * Three properties matter more than the feature itself:
 *
 *  - **Inert until configured.** No OPS_ALERT_WEBHOOK_URL means every call
 *    returns immediately. Shipping this cannot change how anything behaves.
 *  - **Never blocks, never throws.** Alerting sits on the failure path of money
 *    and auth routes. If the relay is down, slow or misconfigured, the request
 *    it was reporting on must still finish normally. Hence after(): the task
 *    runs once the response is out, so the caller waits on nothing, and the
 *    platform keeps the instance alive long enough for it to land. An
 *    unawaited fetch alone is NOT enough — serverless freezes the instance the
 *    moment the response is sent, and the request dies in flight. That is
 *    exactly what happened on the first production test: the route answered
 *    400, the relay never heard a thing.
 *  - **Carries no secrets.** Event name, a short human sentence, and coarse
 *    context only. The whole point is that this leaves the building.
 */

export type OpsAlertSeverity = "warn" | "critical";

type OpsAlert = {
  event: string;
  severity: OpsAlertSeverity;
  summary: string;
  context?: Record<string, string | number | boolean | null>;
};

// One message per event key per window. A forged-webhook flood is one attack,
// not nine hundred notifications — and a phone that buzzes nine hundred times
// gets silenced, which is worse than no alerting at all.
const THROTTLE_MS = 5 * 60 * 1000;
const lastSentAt = new Map<string, number>();

function shouldSend(key: string, now: number): boolean {
  const previous = lastSentAt.get(key);
  if (previous !== undefined && now - previous < THROTTLE_MS) {
    return false;
  }
  lastSentAt.set(key, now);

  // The map is keyed by a fixed set of event names, but prune anyway so a
  // long-lived instance cannot grow one entry per novel key forever.
  if (lastSentAt.size > 200) {
    for (const [entryKey, sentAt] of lastSentAt) {
      if (now - sentAt >= THROTTLE_MS) {
        lastSentAt.delete(entryKey);
      }
    }
  }

  return true;
}

export function notifyOps(alert: OpsAlert): void {
  const url = process.env.OPS_ALERT_WEBHOOK_URL;
  if (!url) {
    return;
  }

  const now = Date.now();
  if (!shouldSend(alert.event, now)) {
    return;
  }

  const send = () =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Channel credential, not customer data — it authenticates this
        // platform to its own relay, so it does not break the "carries no
        // secrets" promise above.
        //
        // Unset means the header is simply absent rather than empty, which is
        // what lets the sending side ship before the receiving side starts
        // checking. The two must roll out in that order: a relay that requires
        // the header before the platform sends it turns every real alert into
        // a silent rejection, and the channel goes mute with nobody noticing.
        ...(process.env.OPS_ALERT_WEBHOOK_SECRET
          ? { "x-ops-secret": process.env.OPS_ALERT_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({
        source: "skillsetmind",
        event: alert.event,
        severity: alert.severity,
        summary: alert.summary,
        context: alert.context ?? {},
        at: new Date(now).toISOString(),
      }),
      // A relay that hangs must not hold an instance open indefinitely.
      signal: AbortSignal.timeout(4_000),
    }).catch(() => {
      // Swallowed on purpose. A failed alert is not worth a failed request, and
      // logging here would just add noise to the log nobody reads.
    });

  try {
    after(send);
  } catch {
    // after() throws outside a request scope (a script, a test). Fall back to
    // the unawaited call: best-effort, but losing the alert entirely is worse.
    void send();
  }
}
