import { NextResponse } from "next/server";

import { createBunnyVideo, signBunnyAssetPath, signBunnyUpload } from "@/lib/bunny/server";
import { enforceRateLimit, paymentErrorResponse } from "@/lib/payments/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/teach/video/create — the course owner asks the server to create a
// Bunny video object and hand back a short-lived TUS upload signature. The
// browser then uploads bytes straight to Bunny (bypassing the serverless body
// limit and giving real per-byte progress). Secrets stay server-side; the
// client only ever sees {videoId, signature, expires, libraryId, endpoint}.

export const runtime = "nodejs";

// Video objects an unpaid creator can create per day (lessons for a course
// built over a few sittings). Paid creators keep only the hourly throttle.
const UNPAID_DAILY_VIDEOS = 20;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  // Every call creates a real Bunny video object on our account, so an
  // unthrottled loop here is a billable-resource DoS: a signed-in user could
  // mint thousands of empty videos against our library. 60/hour comfortably
  // covers a teacher uploading a full course in one sitting.
  try {
    await enforceRateLimit(`teach_video_create_${auth.user.id}`, 60, 60 * 60 * 1000);
  } catch (error) {
    return paymentErrorResponse(error);
  }

  let body: { courseId?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const courseId = typeof body.courseId === "string" ? body.courseId : "";
  const title =
    (typeof body.title === "string" ? body.title : "").slice(0, 200) || "Lesson video";
  if (!courseId) {
    return NextResponse.json({ error: "Missing courseId." }, { status: 400 });
  }

  // Ownership gate. RLS also protects the courses row, but an explicit check
  // turns "not yours" into a clear 403 instead of a silent empty result.
  const { data: course } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (!course) {
    return NextResponse.json({ error: "You do not own this course." }, { status: 403 });
  }

  // No activation wall: uploading video is part of building the course, and
  // the one-time fee is charged at the first Publish. An unpaid creator gets a
  // daily cap on top of the hourly throttle, so the studio does not become free
  // video hosting before Publish.
  // ponytail: UNPAID_DAILY_VIDEOS per 24h. The 24h window outlives
  // purge_stale_rate_limits (it only drops rows idle for 2 days); a longer
  // window would not. A total per-account cap means counting course_assets —
  // add it if the daily cap gets abused.
  const { data: blocked, error: blockedError } = await supabase.rpc("creator_activation_blocked");
  if (blockedError || typeof blocked !== "boolean") {
    return NextResponse.json({ error: "Activation status unavailable." }, { status: 500 });
  }
  if (blocked) {
    try {
      await enforceRateLimit(`teach_video_create_unpaid_${auth.user.id}`, UNPAID_DAILY_VIDEOS, 24 * 60 * 60 * 1000);
    } catch (error) {
      // Over the cap, paying the fee lifts it: answer like the activation gate
      // (402), which the uploader already shows as "pay the activation fee".
      if ((error as { status?: unknown }).status !== 429) return paymentErrorResponse(error);
      return NextResponse.json(
        { error: "Pay the one-time activation fee to keep uploading video today.", code: "activation_required" },
        { status: 402 },
      );
    }
  }

  try {
    const videoId = await createBunnyVideo(title);
    const upload = signBunnyUpload(videoId);
    const storagePath = signBunnyAssetPath(courseId, auth.user.id, videoId);
    return NextResponse.json({ videoId, storagePath, ...upload });
  } catch {
    // Bunny env missing or upstream error → 503 so the client can fall back to
    // a Supabase Storage upload and authoring never hard-blocks.
    return NextResponse.json({ error: "Video host unavailable." }, { status: 503 });
  }
}
