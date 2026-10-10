import { NextResponse } from "next/server";

import { createBunnyVideo, signBunnyAssetPath, signBunnyUpload } from "@/lib/bunny/server";
import { enforceRateLimit, isOnFreePlan, paymentErrorResponse } from "@/lib/payments/server/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/teach/video/create — the course owner asks the server to create a
// Bunny video object and hand back a short-lived TUS upload signature. The
// browser then uploads bytes straight to Bunny (bypassing the serverless body
// limit and giving real per-byte progress). Secrets stay server-side; the
// client only ever sees {videoId, signature, expires, libraryId, endpoint}.

export const runtime = "nodejs";

// Video objects a Free-plan creator can create per day (lessons for a course
// built over a few sittings). Paid plans keep only the hourly throttle.
const FREE_DAILY_VIDEOS = 20;

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

  // A Free-plan creator gets a daily cap on top of the hourly throttle, so the
  // studio does not become free video hosting. It follows the plan, never the
  // activation flag. The key keeps its old "unpaid" name so counters already in
  // the table carry over.
  // ponytail: FREE_DAILY_VIDEOS per 24h. The 24h window outlives
  // purge_stale_rate_limits (it only drops rows idle for 2 days); a longer
  // window would not. A total per-account cap means enforcing
  // videoStorageMinutes — add it if the daily cap gets abused.
  if (await isOnFreePlan(auth.user.id)) {
    try {
      await enforceRateLimit(`teach_video_create_unpaid_${auth.user.id}`, FREE_DAILY_VIDEOS, 24 * 60 * 60 * 1000);
    } catch (error) {
      if ((error as { status?: unknown }).status !== 429) return paymentErrorResponse(error);
      return NextResponse.json(
        { error: "Daily upload limit without a plan. Try again tomorrow.", code: "free_plan_daily_limit" },
        { status: 429 },
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
