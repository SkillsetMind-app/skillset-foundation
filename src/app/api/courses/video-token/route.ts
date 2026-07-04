import { NextResponse } from "next/server";

import { signBunnyEmbedUrl } from "@/lib/bunny/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/courses/video-token — mint a short-lived signed Bunny embed URL for
// a lesson video. Access control IS the existing course_assets RLS: the
// user-scoped client only returns the row to the course owner, an enrolled
// learner, or an admin. No row → no token.

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  let body: { assetId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const assetId = typeof body.assetId === "string" ? body.assetId : "";
  if (!assetId) {
    return NextResponse.json({ error: "Missing assetId." }, { status: 400 });
  }

  const { data: asset } = await supabase
    .from("course_assets")
    .select("bunny_video_id")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset?.bunny_video_id) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  try {
    const embedUrl = signBunnyEmbedUrl(asset.bunny_video_id);
    return NextResponse.json({ embedUrl });
  } catch {
    return NextResponse.json({ error: "Video host unavailable." }, { status: 503 });
  }
}
