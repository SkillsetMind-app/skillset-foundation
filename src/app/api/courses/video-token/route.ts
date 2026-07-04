import { NextResponse } from "next/server";

import { signBunnyEmbedUrl } from "@/lib/bunny/server";
import { canViewCourseAssetVideo } from "@/domain/course-asset";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/courses/video-token — mint a short-lived signed Bunny embed URL for
// a lesson video. Access is gated TWICE: the caller must be signed in, and the
// route resolves the asset with the service-role client and authorizes the
// caller EXPLICITLY (canViewCourseAssetVideo). It does not rely on course_assets
// RLS alone — the RLS policy is not versioned in this repo, so a missing or
// permissive one must not be able to leak a signed embed URL for paid content to
// any signed-in user enumerating assetIds.

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }
  const callerId = auth.user.id;

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

  // Service-role read: deterministic, RLS-independent — the authorization below
  // is the gate, not the SELECT.
  const admin = getSupabaseAdminClient();
  const { data: asset } = await admin
    .from("course_assets")
    .select("bunny_video_id, course_id, owner_id, is_preview")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset?.bunny_video_id) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  // Cheap paths (preview / owner) short-circuit before any extra DB round-trip.
  let entitled = canViewCourseAssetVideo({
    isPreview: asset.is_preview,
    assetOwnerId: asset.owner_id,
    callerId,
    enrollmentStatus: null,
    isAdmin: false,
  });
  if (!entitled) {
    const { data: enrollment } = await admin
      .from("enrollments")
      .select("status")
      .eq("id", `${callerId}__${asset.course_id}`)
      .maybeSingle();
    const { data: isAdmin } = await supabase.rpc("is_admin");
    entitled = canViewCourseAssetVideo({
      isPreview: asset.is_preview,
      assetOwnerId: asset.owner_id,
      callerId,
      enrollmentStatus: enrollment?.status ?? null,
      isAdmin: Boolean(isAdmin),
    });
  }
  if (!entitled) {
    // 404, not 403 — don't confirm the asset exists to a non-entitled caller.
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  try {
    const embedUrl = signBunnyEmbedUrl(asset.bunny_video_id);
    return NextResponse.json({ embedUrl });
  } catch {
    return NextResponse.json({ error: "Video host unavailable." }, { status: 503 });
  }
}
