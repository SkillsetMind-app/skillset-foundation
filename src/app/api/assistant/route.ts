import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { buildAssistantKnowledge } from "@/lib/assistant/knowledge";
import { PaymentError, enforceRateLimit } from "@/lib/payments/server/auth";
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
// flash answers in a few seconds; the pro fallback was measured ~19s. 45s headroom.
const UPSTREAM_TIMEOUT_MS = 45_000;

function rateLimitKeyFromIp(request: Request): string {
  // First hop of x-forwarded-for is the client on Vercel. Hash it so raw IPs
  // never land in the rate_limits table.
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `assistant_ip_${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase.auth.getUser();
  const key = data.user ? `assistant_${data.user.id}` : rateLimitKeyFromIp(request);

  try {
    await enforceRateLimit(supabase, key, RATE_LIMIT_PER_HOUR, 3_600_000);
  } catch (error) {
    if (error instanceof PaymentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  const webhookUrl = process.env.N8N_ASSISTANT_WEBHOOK_URL;
  if (!webhookUrl) {
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

  const secret = process.env.N8N_ASSISTANT_WEBHOOK_SECRET;

  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-assistant-secret": secret } : {}),
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
  } catch {
    // AbortSignal.timeout fires an AbortError here too.
    return NextResponse.json(
      { error: "The assistant is taking too long to respond. Please try again." },
      { status: 504 },
    );
  }
}
