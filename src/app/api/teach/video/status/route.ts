import { NextResponse } from "next/server";

import { getBunnyVideoStatus, hasValidBunnyAssetPath } from "@/lib/bunny/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /api/teach/video/status?assetId=… — the course owner asks for the Bunny
// processing state of one lesson video. Only {status, encodeProgress,
// lengthSeconds} leave this route; the Bunny key stays server-side and nothing
// from the upstream request is logged.

export const runtime = "nodejs";

function notFound() {
  return NextResponse.json({ error: "Video not found." }, { status: 404 });
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const assetId = new URL(request.url).searchParams.get("assetId") ?? "";
  if (!assetId) {
    return NextResponse.json({ error: "Missing assetId." }, { status: 400 });
  }

  const { data: asset } = await supabase
    .from("course_assets")
    .select("course_id, bunny_video_id, storage_path")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset?.bunny_video_id) {
    return notFound();
  }

  // Same ownership gate as /api/teach/video/create: the video's course must
  // belong to the caller.
  const { data: course } = await supabase
    .from("courses")
    .select("id")
    .eq("id", asset.course_id)
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (!course) {
    return notFound();
  }

  try {
    // course_assets is client-writable: the signed receipt proves the server
    // created this video for this course and owner, so a copied video id in
    // someone's own course still gets nothing.
    if (!hasValidBunnyAssetPath(asset.course_id, auth.user.id, asset.bunny_video_id, asset.storage_path)) {
      return notFound();
    }
    const { status, encodeProgress, lengthSeconds } = await getBunnyVideoStatus(asset.bunny_video_id);
    return NextResponse.json(
      { status, encodeProgress, lengthSeconds },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Bunny env missing or upstream error: the studio keeps polling later.
    return NextResponse.json({ error: "Video host unavailable." }, { status: 503 });
  }
}
