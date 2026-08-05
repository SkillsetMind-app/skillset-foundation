import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { syncKnowledgeDoc } from "@/lib/assistant/knowledge-sync";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// GET /api/cron/advisor-knowledge — reindexes the owner-edited knowledge Doc
// into advisor_documents so retrieveKnowledge() has something to search.
//
// Vercel Cron calls this daily (see vercel.json). The owner triggers the SAME
// url by hand after editing the Doc, rather than waiting for the schedule:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//        https://skillsetmind.com/api/cron/advisor-knowledge
//
// One handler serves both because Vercel Cron sends exactly that header. A
// separate "manual" entry point would be a second lock to get right, guarding
// an operation the scheduler's own credential already covers.
//
// AUTH IS THE WHOLE POINT: every run spends OpenAI embedding credit. The Doc is
// public help text, so an open endpoint leaks nothing — it just hands anyone on
// the internet a loop that burns the platform's money. Dormant by design: with
// CRON_SECRET unset the route answers 401 and never touches the database.

export const dynamic = "force-dynamic";

// The sync fetches the Doc (30s ceiling of its own) and then embeds it in serial
// batches, so the platform's default function timeout would cut it off partway
// through the corpus. 60s is the Hobby-plan maximum and covers a help doc with
// room to spare.
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header ?? "");
  // timingSafeEqual throws when the buffers differ in length, so length is
  // compared first — that comparison leaks the secret's length and nothing more,
  // while the byte comparison stays constant-time.
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let admin;
  try {
    // Service role: advisor_documents is deny-all under RLS (reads go through
    // the SECURITY DEFINER match function), so nothing else can write it.
    admin = getSupabaseAdminClient();
  } catch {
    // Keeps every response on this route machine-readable JSON. A missing
    // service-role key is the likeliest first-deploy failure, and letting it
    // throw would answer the scheduler with Next's HTML error page instead.
    return NextResponse.json(
      { ok: false, chunks: 0, skipped: false, reason: "service_role_missing" },
      { status: 500 },
    );
  }

  const result = await syncKnowledgeDoc(admin);

  // The status code is the alert: Vercel marks a cron run failed on 4xx/5xx and
  // green on 2xx, so a real breakage (Doc unshared, embeddings rejected, upsert
  // refused) has to be a 500 — a sync that answers 200 while quietly failing is
  // a sync nobody ever fixes, and the advisor keeps quoting last month's text.
  // `skipped` is the one case that is NOT a breakage: it means this feature's
  // env vars were never set, which the module treats as not-yet-configured and
  // which the advisor UI already surfaces. Alerting daily on it would only teach
  // the owner to ignore cron alerts.
  return NextResponse.json(result, { status: result.ok || result.skipped ? 200 : 500 });
}
