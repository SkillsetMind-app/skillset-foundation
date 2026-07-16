import { NextResponse } from "next/server";

import { canViewCourseAssetVideo } from "@/domain/course-asset";
import { signBunnyEmbedUrl } from "@/lib/bunny/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Protected playback uses assetId plus an explicit entitlement check. Public
// playback resolves only the configured preview lesson of a published course.
export const runtime = "nodejs";

type VideoAsset = {
  bunny_video_id: string | null;
  course_id: string;
  owner_id: string;
  is_preview: boolean;
};

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  const callerId = authError ? null : auth.user?.id ?? null;

  let body: {
    assetId?: unknown;
    courseId?: unknown;
    lessonId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const assetId = typeof body.assetId === "string" ? body.assetId.trim() : "";
  const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
  const lessonId = typeof body.lessonId === "string" ? body.lessonId.trim() : "";
  const hasPublicSelector = Boolean(courseId || lessonId);
  const isPublicPreviewRequest = Boolean(courseId && lessonId);

  if (
    (!assetId && !isPublicPreviewRequest)
    || (assetId && hasPublicSelector)
  ) {
    return NextResponse.json({ error: "Invalid video selector." }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  let asset: VideoAsset | null = null;

  if (isPublicPreviewRequest) {
    const { data: publishedCourse, error: courseError } = await admin
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("status", "published")
      .eq("free_preview_lesson_id", lessonId)
      .maybeSingle();

    if (courseError) {
      return NextResponse.json({ error: "Video host unavailable." }, { status: 503 });
    }
    if (!publishedCourse) {
      return NextResponse.json({ error: "Not available." }, { status: 404 });
    }

    const { data: previewAsset, error: assetError } = await admin
      .from("course_assets")
      .select("bunny_video_id, course_id, owner_id, is_preview")
      .eq("course_id", courseId)
      .eq("lesson_id", lessonId)
      .eq("kind", "lesson_video")
      .eq("is_preview", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (assetError) {
      return NextResponse.json({ error: "Video host unavailable." }, { status: 503 });
    }
    asset = previewAsset;
  } else {
    if (!callerId) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const { data: protectedAsset, error: assetError } = await admin
      .from("course_assets")
      .select("bunny_video_id, course_id, owner_id, is_preview")
      .eq("id", assetId)
      .maybeSingle();

    if (assetError) {
      return NextResponse.json({ error: "Video host unavailable." }, { status: 503 });
    }
    asset = protectedAsset;
  }

  if (!asset?.bunny_video_id) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }

  if (!isPublicPreviewRequest) {
    let entitled = canViewCourseAssetVideo({
      isPreview: asset.is_preview,
      assetOwnerId: asset.owner_id,
      callerId: callerId!,
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
        callerId: callerId!,
        enrollmentStatus: enrollment?.status ?? null,
        isAdmin: Boolean(isAdmin),
      });
    }
    if (!entitled) {
      return NextResponse.json({ error: "Not available." }, { status: 404 });
    }
  }

  try {
    const embedUrl = signBunnyEmbedUrl(asset.bunny_video_id);
    return NextResponse.json({ embedUrl });
  } catch {
    return NextResponse.json({ error: "Video host unavailable." }, { status: 503 });
  }
}
