import { NextResponse } from "next/server";

import { canViewCourseAssetVideo } from "@/domain/course-asset";
import { getLessonUnlockState, type DripStrategy } from "@/domain/drip-policy";
import { signBunnyEmbedUrl } from "@/lib/bunny/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { allowByIp, allowByKey } from "@/lib/supabase/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Protected playback uses assetId plus an explicit entitlement check. Public
// playback resolves only the configured preview lesson of a published course.
export const runtime = "nodejs";

// Every call mints a signed embed URL, so an unthrottled loop is a token
// factory. A student changing lessons fires one per video; 120/min per member
// is far above real playback, and anonymous preview callers get half that.
const TOKENS_PER_MINUTE = 120;
const ANON_TOKENS_PER_MINUTE = 60;

type VideoAsset = {
  bunny_video_id: string | null;
  course_id: string;
  owner_id: string;
  is_preview: boolean;
  lesson_id: string | null;
};

type RawModule = {
  lessons?: Array<{ id: string; dripDelayDays?: number | null }>;
};

// Drip is a promise the teacher configured: "lesson 3 opens on day 14". It was
// enforced only in the browser, so an enrolled student could POST an assetId
// read from the course_assets subscription and get a signed embed URL for a
// lesson that has not opened yet. Same rule, same domain function, server side.
async function isLessonDripLocked(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  params: {
    courseId: string;
    lessonId: string;
    userId: string;
    enrolledAt: string | null;
  },
): Promise<boolean> {
  const { data: course } = await admin
    .from("courses")
    .select("modules, drip_strategy, drip_interval_days, free_preview_lesson_id")
    .eq("id", params.courseId)
    .maybeSingle();

  const strategy = (course?.drip_strategy as DripStrategy | null) ?? "instant";
  if (!course || strategy === "instant") {
    return false;
  }

  // modules is a JSONB column, so lessons can be missing on a malformed row.
  const modules = ((course.modules as unknown as RawModule[] | null) ?? []).map(
    (module) => ({ ...module, lessons: module.lessons ?? [] }),
  );
  const lesson = modules
    .flatMap((module) => module.lessons)
    .find((item) => item.id === params.lessonId);
  // The asset points at a lesson the course no longer lists: nothing to schedule.
  if (!lesson) {
    return false;
  }

  // sequential_progress is the only strategy that reads progress; the rest are
  // date math off the enrollment, so skip the query for them.
  let completedLessonIds: string[] = [];
  if (strategy === "sequential_progress") {
    const { data: progress } = await admin
      .from("lesson_progress")
      .select("lesson_id")
      .eq("user_id", params.userId)
      .eq("enrollment_id", `${params.userId}__${params.courseId}`);
    completedLessonIds = (progress ?? []).map((row) => row.lesson_id);
  }

  const state = getLessonUnlockState(
    {
      dripStrategy: strategy,
      dripIntervalDays: course.drip_interval_days,
      modules,
    },
    { ...lesson, isPreview: lesson.id === course.free_preview_lesson_id },
    { createdAt: params.enrolledAt },
    completedLessonIds,
  );

  return !state.unlocked;
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  const callerId = authError ? null : auth.user?.id ?? null;

  const allowed = callerId
    ? await allowByKey(`video_token_${callerId}`, TOKENS_PER_MINUTE, 60_000)
    : await allowByIp(request, "video_token", ANON_TOKENS_PER_MINUTE, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

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
      .select("bunny_video_id, course_id, owner_id, is_preview, lesson_id")
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
      .select("bunny_video_id, course_id, owner_id, is_preview, lesson_id")
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
    // The preview flag alone is not a grant. The anonymous path above gates
    // preview playback on three facts — course published, lesson is the
    // course's designated free preview, asset flagged preview — so the
    // signed-in path must not be the weaker door. Trusting asset.is_preview by
    // itself handed a signed embed URL for any draft-course lesson a teacher
    // flagged while authoring to any signed-in user who knew the assetId.
    // Owners skip the lookup: ownership already entitles them one line later.
    let effectiveIsPreview = false;
    if (asset.is_preview && asset.lesson_id && asset.owner_id !== callerId) {
      const { data: publishedCourse } = await admin
        .from("courses")
        .select("id")
        .eq("id", asset.course_id)
        .eq("status", "published")
        .eq("free_preview_lesson_id", asset.lesson_id)
        .maybeSingle();
      effectiveIsPreview = Boolean(publishedCourse);
    }

    // Preview and ownership are decided without touching the database; anything
    // else has to come from an enrollment or an admin flag.
    const previewOrOwner = canViewCourseAssetVideo({
      isPreview: effectiveIsPreview,
      assetOwnerId: asset.owner_id,
      callerId: callerId!,
      enrollmentStatus: null,
      isAdmin: false,
    });
    let entitled = previewOrOwner;
    let enrolledAt: string | null = null;
    let viewerIsAdmin = false;
    if (!entitled) {
      const { data: enrollment } = await admin
        .from("enrollments")
        .select("status, created_at")
        .eq("id", `${callerId}__${asset.course_id}`)
        .maybeSingle();
      const { data: isAdmin } = await supabase.rpc("is_admin");
      viewerIsAdmin = Boolean(isAdmin);
      enrolledAt = enrollment?.created_at ?? null;
      entitled = canViewCourseAssetVideo({
        isPreview: effectiveIsPreview,
        assetOwnerId: asset.owner_id,
        callerId: callerId!,
        enrollmentStatus: enrollment?.status ?? null,
        isAdmin: viewerIsAdmin,
      });
    }
    if (!entitled) {
      return NextResponse.json({ error: "Not available." }, { status: 404 });
    }

    // Drip only binds students. A teacher previewing their own course and an
    // admin investigating one both need every lesson regardless of schedule.
    if (!previewOrOwner && !viewerIsAdmin && asset.lesson_id) {
      const locked = await isLessonDripLocked(admin, {
        courseId: asset.course_id,
        lessonId: asset.lesson_id,
        userId: callerId!,
        enrolledAt,
      });
      if (locked) {
        return NextResponse.json({ error: "Not available." }, { status: 404 });
      }
    }
  }

  try {
    const embedUrl = signBunnyEmbedUrl(asset.bunny_video_id);
    return NextResponse.json({ embedUrl });
  } catch {
    return NextResponse.json({ error: "Video host unavailable." }, { status: 503 });
  }
}
