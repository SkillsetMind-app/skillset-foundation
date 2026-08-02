import { NextResponse } from "next/server";

import { runRateLimit } from "@/lib/supabase/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/teach/advisor — proxies a teacher's chat to an n8n webhook that
// fronts DeepSeek. Auth + rate-limit + input caps live here (the trust
// boundary); prompt/model orchestration lives in n8n so it can evolve without a
// redeploy. Degrades to a friendly 503 when the webhook URL/secret are unset,
// so the UI can render a calm "being set up" state instead of an error.

type AdvisorMessage = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 20; // only the tail of the thread is forwarded
const MAX_CHARS = 4000; // per-message cap — bounds payload + model cost
// deepseek-v4-pro (reasoning) measured ~19s on complex questions; 60s gives headroom.
const UPSTREAM_TIMEOUT_MS = 60_000;

// Reject NUL + C0/C1 control chars (tab/newline/CR allowed): they have no place
// in a chat message and are a classic vector for smuggling a payload past a
// downstream parser (prompt injection into the n8n/model layer). Char-code
// check instead of a regex to keep the source free of invisible control bytes.
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) return true;
    if (c >= 0x80 && c <= 0x9f) return true; // C1 — the comment above promised these

  }
  return false;
}

// In-process cap on concurrent upstream calls. Vercel runs one counter per warm
// lambda, so the effective cap is MAX_INFLIGHT × instances — enough to keep a
// burst from exhausting the n8n/DeepSeek worker pool without a shared store.
// ponytail: per-instance; swap for a shared counter only if multi-instance
// bursts ever become the bottleneck.
let inFlight = 0;
const MAX_INFLIGHT = 6;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const uid = data.user.id;

  // The widget is teacher-gated in advisor-sidebar.tsx, but that is the shop
  // window, not the lock — this endpoint is reachable directly with any
  // signed-in session, and every accepted call spends paid reasoning-model
  // inference. The sibling /api/teach routes gate on course ownership; a chat
  // owns no course, so nothing here stood in for that. Mirrors how
  // requireAdminUserId leans on the SECURITY DEFINER role RPC (is_teacher()
  // accepts teacher OR admin). Authorize before throttling: someone who may
  // not use this at all shouldn't consume a rate-limit slot to find out.
  const { data: isTeacher, error: roleError } = await supabase.rpc("is_teacher");
  if (roleError || !isTeacher) {
    return NextResponse.json(
      { error: "Teacher access is required." },
      { status: 403 },
    );
  }

  // Two-window throttle on a reasoning-model-backed endpoint: an hourly burst
  // cap (30/h) blunts scripted abuse, and a daily cap (120/day) bounds sustained
  // economic abuse (every turn fans out to DeepSeek). Both use the shared
  // enforce_rate_limit SECURITY DEFINER RPC.
  for (const [key, limit, windowMs] of [
    [`advisor_${uid}`, 30, 3_600_000],
    [`advisor_daily_${uid}`, 120, 86_400_000],
  ] as const) {
    try {
      const { error: rlError } = await runRateLimit(key, limit, windowMs);
      if (rlError) {
        if (rlError.message?.includes("RATE_LIMIT")) {
          return NextResponse.json(
            { error: "Too many messages. Please wait a moment before continuing." },
            { status: 429 },
          );
        }
        return NextResponse.json(
          { error: "Something went wrong. Please try again." },
          { status: 500 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }
  }

  const webhookUrl = process.env.N8N_ADVISOR_WEBHOOK_URL;
  const secret = process.env.N8N_ADVISOR_WEBHOOK_SECRET;
  // Fail closed: never call the n8n webhook without the shared secret. A missing
  // secret is a misconfiguration surfaced as the same calm "being set up" state,
  // so the webhook can never be invoked unauthenticated — which would let anyone
  // who discovers the URL impersonate a teacher by passing an arbitrary uid.
  if (!webhookUrl || !secret) {
    return NextResponse.json(
      {
        error: "advisor_not_configured",
        reply: "The studio advisor is being set up and will be available shortly.",
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

  const raw = Array.isArray(body.messages) ? (body.messages as AdvisorMessage[]) : [];
  const cleaned = raw
    .filter(
      (m): m is AdvisorMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return NextResponse.json({ error: "Send a message to the advisor." }, { status: 400 });
  }

  if (cleaned.some((m) => hasControlChar(m.content))) {
    return NextResponse.json(
      { error: "Message contains unsupported characters." },
      { status: 400 },
    );
  }

  if (inFlight >= MAX_INFLIGHT) {
    return NextResponse.json(
      { error: "The advisor is busy right now. Please try again in a moment." },
      { status: 429 },
    );
  }

  inFlight += 1;
  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-advisor-secret": secret,
      },
      body: JSON.stringify({ teacherId: uid, messages: cleaned }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "The advisor is unavailable right now. Please try again." },
        { status: 502 },
      );
    }

    // n8n flows return the model text under different keys depending on the node
    // wiring; accept the common ones so the flow author isn't locked to one shape.
    const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    const reply = [payload.reply, payload.output, payload.text, payload.message].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );

    if (!reply) {
      return NextResponse.json(
        { error: "The advisor returned an empty reply. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ reply });
  } catch (caughtError) {
    // Two very different failures land here. A timer expiring is a slow answer;
    // an unreachable host (DNS gone, connection refused, webhook VPS down)
    // rejects before any timer fires and means the answer is never coming.
    // Telling a teacher to "try again" in that second case sends them into a
    // retry loop against nothing — from where they sit it is indistinguishable
    // from a backend that was never wired, so it gets the same calm copy as the
    // missing-env branch above. Match on name, not instanceof: AbortSignal
    // .timeout rejects with a DOMException, which is not an Error subclass in
    // every runtime this ships to.
    const failure = (caughtError as { name?: string } | null)?.name;
    if (failure !== "TimeoutError" && failure !== "AbortError") {
      return NextResponse.json(
        {
          error: "advisor_not_configured",
          reply: "The studio advisor is being set up and will be available shortly.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "The advisor is taking too long to respond. Please try again." },
      { status: 504 },
    );
  } finally {
    inFlight -= 1;
  }
}
