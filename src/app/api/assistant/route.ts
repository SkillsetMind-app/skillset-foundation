import { NextResponse } from "next/server";

import { buildAssistantKnowledge } from "@/lib/assistant/knowledge";
import { PaymentError, enforceRateLimit } from "@/lib/payments/server/auth";
import { rateLimitKeyFromIp } from "@/lib/supabase/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/assistant — the public platform help assistant. Proxies a visitor's
// chat to an n8n webhook that fronts DeepSeek, grounded in the same FAQ/plans
// content the site renders (buildAssistantKnowledge). This route is the trust
// boundary: rate-limit + input caps live here; prompt/model orchestration lives
// in n8n so it can evolve without a redeploy. Unlike the teacher advisor this
// endpoint is open to signed-out visitors (pre-sales questions are the point),
// so the throttle keys on the session uid when present and a hashed IP when not.

type AssistantMessage = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 12; // only the tail of the thread is forwarded
const MAX_CHARS = 1200; // per-message cap — public endpoint, keep payloads tight
const RATE_LIMIT_PER_HOUR = 20;
const RATE_LIMIT_PER_DAY = 80; // bounds sustained economic abuse (every turn hits DeepSeek)
// flash answers in a few seconds; the pro fallback was measured ~19s. 45s headroom.
const UPSTREAM_TIMEOUT_MS = 45_000;

// Reject NUL + C0/C1 control chars (tab/newline/CR allowed): they have no place
// in a chat message and are a classic vector for smuggling a payload past a
// downstream parser (prompt injection into the n8n/model layer). Char-code
// check instead of a regex to keep the source free of invisible control bytes.
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) return true;
  }
  return false;
}

// In-process cap on concurrent upstream calls. Vercel runs one counter per warm
// lambda, so the effective cap is MAX_INFLIGHT × instances — enough to keep a
// burst from exhausting the n8n/DeepSeek worker pool without a shared store.
// ponytail: per-instance; swap for a shared counter only if multi-instance
// bursts ever become the bottleneck.
let inFlight = 0;
const MAX_INFLIGHT = 8;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase.auth.getUser();
  // Signed-out visitors are keyed by the shared hashed-IP helper (peppered),
  // the same one every other public route uses — a local sha256 copy lived here
  // and missed the pepper.
  const key = data.user
    ? `assistant_${data.user.id}`
    : rateLimitKeyFromIp(request, "assistant_ip");

  try {
    await enforceRateLimit(key, RATE_LIMIT_PER_HOUR, 3_600_000);
    await enforceRateLimit(`${key}_daily`, RATE_LIMIT_PER_DAY, 86_400_000);
  } catch (error) {
    if (error instanceof PaymentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  const webhookUrl = process.env.N8N_ASSISTANT_WEBHOOK_URL;
  const secret = process.env.N8N_ASSISTANT_WEBHOOK_SECRET;
  // Fail closed: never call the n8n webhook without the shared secret. A missing
  // secret is a misconfiguration surfaced as the calm "being set up" state, so
  // the webhook can never be invoked unauthenticated — which would let anyone
  // who discovers the URL burn DeepSeek credits and siphon the knowledge context.
  if (!webhookUrl || !secret) {
    return NextResponse.json(
      {
        error: "assistant_not_configured",
        reply: "The assistant is being set up and will be available shortly.",
      },
      { status: 503 },
    );
  }

  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const raw = Array.isArray(body.messages) ? (body.messages as AssistantMessage[]) : [];
  const cleaned = raw
    .filter(
      (m): m is AssistantMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return NextResponse.json({ error: "Send a message to the assistant." }, { status: 400 });
  }

  if (cleaned.some((m) => hasControlChar(m.content))) {
    return NextResponse.json(
      { error: "Message contains unsupported characters." },
      { status: 400 },
    );
  }

  if (inFlight >= MAX_INFLIGHT) {
    return NextResponse.json(
      { error: "The assistant is busy right now. Please try again in a moment." },
      { status: 429 },
    );
  }

  inFlight += 1;
  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-assistant-secret": secret,
      },
      body: JSON.stringify({ messages: cleaned, context: buildAssistantKnowledge() }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "The assistant is unavailable right now. Please try again." },
        { status: 502 },
      );
    }

    const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    const reply = [payload.reply, payload.output, payload.text, payload.message].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );

    if (!reply) {
      return NextResponse.json(
        { error: "The assistant returned an empty reply. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ reply });
  } catch (caughtError) {
    // Same split as /api/teach/advisor: a timer expiring is a slow answer, an
    // unreachable host is no answer at all, and only the first one is worth
    // retrying. See that route for the full reasoning.
    const failure = (caughtError as { name?: string } | null)?.name;
    if (failure !== "TimeoutError" && failure !== "AbortError") {
      return NextResponse.json(
        {
          error: "assistant_not_configured",
          reply: "The assistant is being set up and will be available shortly.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "The assistant is taking too long to respond. Please try again." },
      { status: 504 },
    );
  } finally {
    inFlight -= 1;
  }
}
