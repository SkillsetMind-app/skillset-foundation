import { NextResponse } from "next/server";

import { buildAssistantKnowledge } from "@/lib/assistant/knowledge";
import { KimiConfigError, KimiError, askKimi, type KimiMessage } from "@/lib/assistant/kimi";
import { formatKnowledge, retrieveKnowledge } from "@/lib/assistant/retrieve";
import { buildTeacherContext } from "@/lib/assistant/teacher-context";
import { runRateLimit } from "@/lib/supabase/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/teach/advisor — answers a teacher's question with kimi-k2.6.
// GET  /api/teach/advisor — returns the teacher's most recent thread.
//
// This used to proxy an n8n webhook fronting DeepSeek. That put the prompt, the
// model choice and the failure behaviour outside this repo and outside CI, and
// added a hop that could (and did) go stale while every health check stayed
// green. The model contract now lives here, in version control, with tests.
//
// The reply is grounded in three layers, most general to most specific:
//   1. buildAssistantKnowledge()  — the shipped corpus (plans, fees, FAQ)
//   2. retrieveKnowledge()        — passages from the owner-edited Doc, searched
//   3. buildTeacherContext()      — this teacher's live catalogue and payments
// Every one of them degrades to empty rather than throwing, because a thinner
// answer beats no answer — and the system prompt below is written so that an
// empty layer produces "I don't know" instead of an invention.

// Reasoning models think before they speak, and the wall-clock is the part that
// bites. Measured against the live endpoint on questions that need real work:
// 49-68 SECONDS, with 2500-4000 tokens spent reasoning before the first character
// of the answer. An earlier version of this file capped the whole request at 60s
// on the belief that was Vercel's ceiling; it is not — the platform allows 300 —
// and 60 would have killed the hardest questions, which are the only ones worth
// asking an advisor. Set the platform ceiling high and let our own budget below
// be the thing that actually decides, so a stall surfaces as our 504 with usable
// copy instead of the platform severing the function mid-thought.
export const maxDuration = 300;

type AdvisorMessage = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 20; // only the tail of the thread is forwarded
const MAX_CHARS = 4000; // per-message cap — bounds payload + model cost
// Roughly 2x the slowest measured reasoning call (68s), which leaves headroom for
// a long question with a full context block without waiting on a genuinely hung
// upstream forever. Sits well inside maxDuration so WE time out, not the platform.
// ponytail: a teacher stares at a spinner for up to this long. The real fix is
// streaming the reply so thinking is visible; do that when the sidebar can render
// partial text, and this number drops back to a courtesy ceiling.
const UPSTREAM_TIMEOUT_MS = 150_000;
const MAX_TITLE_CHARS = 120;

// Reject NUL + C0/C1 control chars (tab/newline/CR allowed): they have no place
// in a chat message and are a classic vector for smuggling a payload past a
// downstream parser. Char-code check instead of a regex to keep the source free
// of invisible control bytes.
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
// burst from exhausting paid inference without a shared store.
// ponytail: per-instance; swap for a shared counter only if multi-instance
// bursts ever become the bottleneck.
let inFlight = 0;
const MAX_INFLIGHT = 6;

// The behaviour contract. It is deliberately blunt about the failure mode that
// matters: a model asked for business advice will happily invent a commission
// rate, a refund window or a payout schedule, and a teacher has no way to tell
// an invented number from a real one. Everything below exists to make "I don't
// know" the cheapest available answer.
const SYSTEM_PROMPT = `You are the Studio Advisor inside SkillsetMind, helping a teacher build and sell their online course.

GROUNDING — this is the rule that matters most:
- Answer ONLY from the context blocks supplied in this conversation. They are your entire knowledge of this platform.
- If the context does not contain the answer, say so plainly and point the teacher to the /support page. Never fill a gap with a plausible guess.
- Never state a fee, commission rate, refund window, payout timing, deadline or any other number unless that exact number appears in the context. If you are reasoning toward a suggested price, label it explicitly as a starting point to test, not as platform policy.
- Never claim a platform feature exists unless the context describes it.

USING THE TEACHER'S OWN SITUATION:
- The context includes this teacher's real courses, prices, student counts and payment status. Use those specifics. Generic course-selling advice is a failure.
- If their Stripe setup is incomplete they cannot receive money at all, so raise that before any advice about marketing, pricing or launching.

BOUNDARIES:
- No legal, tax or accounting advice. Explain how the platform works mechanically, then tell them to consult a qualified professional in their country.
- Never ask for a password, bank account number, government ID, card number or verification code. If the teacher volunteers one, tell them to remove it.
- Stay on teaching, course building, pricing and selling on SkillsetMind. Redirect anything else briefly and politely.

STYLE:
- Short and concrete. One specific next action beats five general suggestions.
- Plain prose. No markdown headings, no bold, no bullet characters — the chat panel renders raw text.
- Address the artifact (the course, the price, the description), never the person.`;

function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_TITLE_CHARS ? flat : `${flat.slice(0, MAX_TITLE_CHARS - 1)}…`;
}

/**
 * Persist the turn. Best-effort by design: the teacher already has their answer
 * on screen by the time this runs, and losing the transcript is a smaller harm
 * than turning a good reply into an error. Returns the conversation id when it
 * is safe to hand back to the client, null when nothing was stored.
 *
 * SECURITY: uses the request-scoped client, so RLS proves ownership. A supplied
 * conversationId belonging to another teacher fails the message policy's WITH
 * CHECK and stores nothing — the id is never trusted just because it parsed.
 */
async function persistTurn(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  uid: string,
  conversationId: string | null,
  question: string,
  reply: string,
): Promise<string | null> {
  try {
    let id = conversationId;
    if (!id) {
      const { data, error } = await supabase
        .from("advisor_conversations")
        .insert({ teacher_id: uid, title: titleFrom(question) })
        .select("id")
        .single();
      if (error || !data) return null;
      id = data.id as string;
    }

    const { error } = await supabase.from("advisor_messages").insert([
      { conversation_id: id, role: "user", content: question.slice(0, MAX_CHARS) },
      { conversation_id: id, role: "assistant", content: reply.slice(0, 8000) },
    ]);
    // An error here means the id was not ours (RLS refused). Returning it anyway
    // would have the client keep sending an id that can never store anything.
    return error ? null : id;
  } catch {
    return null;
  }
}

/** The teacher's most recent thread, so a page reload does not lose the chat. */
export async function GET() {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  // No is_teacher gate and no rate limit: RLS already scopes this to the
  // caller's own rows, so the worst a non-teacher can do is read their own empty
  // list. Gating it would spend a database round-trip to protect nothing.
  const { data: conversation } = await supabase
    .from("advisor_conversations")
    .select("id")
    .eq("teacher_id", data.user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) return NextResponse.json({ conversationId: null, messages: [] });

  const { data: messages } = await supabase
    .from("advisor_messages")
    .select("role,content")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .limit(200);

  return NextResponse.json({
    conversationId: conversation.id,
    messages: (messages ?? []) as AdvisorMessage[],
  });
}

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
  // inference. Mirrors how requireAdminUserId leans on the SECURITY DEFINER role
  // RPC (is_teacher() accepts teacher OR admin). Authorize before throttling:
  // someone who may not use this at all shouldn't consume a slot to find out.
  const { data: isTeacher, error: roleError } = await supabase.rpc("is_teacher");
  if (roleError || !isTeacher) {
    return NextResponse.json({ error: "Teacher access is required." }, { status: 403 });
  }

  // Two-window throttle on a reasoning-model-backed endpoint: an hourly burst
  // cap (30/h) blunts scripted abuse, and a daily cap (120/day) bounds sustained
  // economic abuse. Both use the shared enforce_rate_limit SECURITY DEFINER RPC.
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

  let body: { messages?: unknown; conversationId?: unknown };
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

  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.length > 0
      ? body.conversationId
      : null;

  if (inFlight >= MAX_INFLIGHT) {
    return NextResponse.json(
      { error: "The advisor is busy right now. Please try again in a moment." },
      { status: 429 },
    );
  }

  const question = cleaned[cleaned.length - 1].content;

  // Both grounding lookups swallow their own failures, so this pair cannot throw
  // — deliberately, because the catch around the model call below reads a throw
  // as "the model is unreachable" and would answer "being set up", which is a
  // lie when the real failure was a context query. Run them together: the
  // embedding round-trip and the catalogue queries have no reason to be serial.
  const [teacherContext, passages] = await Promise.all([
    buildTeacherContext(supabase, uid).catch(() => ""),
    retrieveKnowledge(supabase, question),
  ]);

  const context = [buildAssistantKnowledge(), formatKnowledge(passages), teacherContext]
    .filter((block) => block.length > 0)
    .join("\n\n");

  const messages: KimiMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    // Context rides as its own system turn rather than being glued onto the
    // instructions: it is data, and keeping it separate makes it harder for a
    // sentence inside the Doc to read as an instruction to the model.
    { role: "system", content: context },
    ...cleaned,
  ];

  inFlight += 1;
  try {
    const reply = await askKimi({
      messages,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const storedId = await persistTurn(supabase, uid, conversationId, question, reply);
    return NextResponse.json({ reply, conversationId: storedId });
  } catch (caughtError) {
    // A missing key is a deployment gap, not a failed request: same calm copy
    // the UI already renders for an unconfigured backend.
    if (caughtError instanceof KimiConfigError) {
      return NextResponse.json(
        {
          error: "advisor_not_configured",
          reply: "The studio advisor is being set up and will be available shortly.",
        },
        { status: 503 },
      );
    }

    if (caughtError instanceof KimiError) {
      // Retrying an exhausted reasoning budget fails identically, so this one
      // asks for a different question instead of the usual "try again".
      const message =
        caughtError.code === "reasoning_budget_exhausted"
          ? "That question was too broad for the advisor to finish. Try asking about one thing at a time."
          : "The advisor is unavailable right now. Please try again.";
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Match on name, not instanceof: AbortSignal.timeout rejects with a
    // DOMException, which is not an Error subclass in every runtime this ships
    // to. Anything else here is the host being unreachable — from where the
    // teacher sits that is indistinguishable from a backend never wired, so it
    // gets the same calm copy as the missing-key branch.
    const failure = (caughtError as { name?: string } | null)?.name;
    if (failure === "TimeoutError" || failure === "AbortError") {
      return NextResponse.json(
        { error: "The advisor is taking too long to respond. Please try again." },
        { status: 504 },
      );
    }
    return NextResponse.json(
      {
        error: "advisor_not_configured",
        reply: "The studio advisor is being set up and will be available shortly.",
      },
      { status: 503 },
    );
  } finally {
    inFlight -= 1;
  }
}
