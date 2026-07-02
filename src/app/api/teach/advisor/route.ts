import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/teach/advisor — proxies a teacher's chat to an n8n webhook that
// fronts DeepSeek. Auth + rate-limit + input caps live here (the trust
// boundary); prompt/model orchestration lives in n8n so it can evolve without a
// redeploy. Degrades to a friendly 503 when N8N_ADVISOR_WEBHOOK_URL is unset,
// so the UI can render a calm "being set up" state instead of an error.

type AdvisorMessage = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 20; // only the tail of the thread is forwarded
const MAX_CHARS = 4000; // per-message cap — bounds payload + model cost
// deepseek-v4-pro (reasoning) measured ~19s on complex questions; 60s gives headroom.
const UPSTREAM_TIMEOUT_MS = 60_000;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const uid = data.user.id;

  // Throttle repeated calls (the enforce_rate_limit SECURITY DEFINER RPC used
  // across the app). 30 advisor turns/hour per teacher — generous for real use,
  // tight enough to blunt scripted abuse of a model-backed endpoint.
  const { error: rlError } = await supabase.rpc("enforce_rate_limit", {
    p_key: `advisor_${uid}`,
    p_limit: 30,
    p_window_ms: 3_600_000,
  });
  if (rlError) {
    if (rlError.message?.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "Too many messages. Please wait a moment before continuing." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  const webhookUrl = process.env.N8N_ADVISOR_WEBHOOK_URL;
  if (!webhookUrl) {
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

  // Optional shared secret n8n verifies, so the webhook can't be hit directly.
  const secret = process.env.N8N_ADVISOR_WEBHOOK_SECRET;

  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-advisor-secret": secret } : {}),
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
  } catch {
    // AbortSignal.timeout fires an AbortError here too.
    return NextResponse.json(
      { error: "The advisor is taking too long to respond. Please try again." },
      { status: 504 },
    );
  }
}
