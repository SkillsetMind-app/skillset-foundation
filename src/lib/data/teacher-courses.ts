"use client";

import type {
  CreateTeacherCourseInput,
  TeacherCourse,
  TeacherCourseStatus,
  UpdateTeacherCourseBuilderInput,
} from "@/domain/teacher-course";
import {
  MAX_MEMBERS_DESCRIPTION_LENGTH,
  MAX_MEMBERS_SUBTITLE_LENGTH,
  MAX_MEMBERS_TITLE_LENGTH,
  normalizeCourseCategories,
  normalizeInstallmentsMax,
  normalizeLearningOutcomes,
  normalizeMembersText,
  normalizeMembersTheme,
  normalizeTeacherCourseModules,
} from "@/domain/teacher-course";
import { rowToTeacherCourse } from "@/lib/data/published-courses";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database, Json } from "@/lib/supabase/database.types";

const coursesTable = "courses";

type CourseRow = Database["public"]["Tables"]["courses"]["Row"];

// createTeacherCourseDraft callable → create_teacher_course_draft RPC
// (SECURITY DEFINER): enforces the teacher/terms gate, rate limit, and title-key
// uniqueness server-side, then inserts the draft with a plan-derived platform
// fee. Returns the new course id.
export async function createTeacherCourse(input: CreateTeacherCourseInput) {
  const supabase = getSupabaseBrowserClient();
  const paymentType = input.paymentType ?? "one_time";
  const categories = normalizeCourseCategories([
    ...(input.categories ?? []),
    input.category,
  ]);

  const { data, error } = await supabase.rpc("create_teacher_course_draft", {
    p_title: input.title,
    p_summary: input.summary,
    p_category: categories[0] ?? input.category,
    p_categories: categories,
    p_payment_type: paymentType,
  });

  if (error) {
    throw error;
  }

  return data as string;
}

// updateTeacherCourseBuilder callable → update_teacher_course_builder RPC.
// The client normalizes cosmetic fields (modules/outcomes/categories/members)
// via the shared domain helpers; the RPC re-derives the security-critical
// fields server-side (title_key, lesson_count, platform_fee_bps, free-price)
// and writes the frozen platform_fee_bps through the trusted-write flag.
export async function updateTeacherCourseBuilder(
  courseId: string,
  input: UpdateTeacherCourseBuilderInput,
) {
  const supabase = getSupabaseBrowserClient();
  const categories = normalizeCourseCategories([
    ...(input.categories ?? []),
    input.category,
  ]);

  const payload = {
    title: input.title.trim(),
    summary: input.summary.trim(),
    category: (categories[0] ?? input.category).trim(),
    categories,
    learningOutcomes: normalizeLearningOutcomes(input.learningOutcomes),
    modules: normalizeTeacherCourseModules(input.modules),
    paymentType: input.paymentType,
    priceAmountMinor: input.priceAmountMinor,
    currency: input.currency,
    installmentsEnabled: input.installmentsEnabled,
    installmentsMax: normalizeInstallmentsMax(input.installmentsMax),
    dripStrategy: input.dripStrategy,
    dripIntervalDays: input.dripIntervalDays,
    freePreviewLessonId: input.freePreviewLessonId,
    membersTheme: normalizeMembersTheme(input.membersTheme),
    membersCoverAssetId: normalizeMembersText(
      input.membersCoverAssetId ?? null,
      160,
    ),
    membersTitle: normalizeMembersText(
      input.membersTitle ?? null,
      MAX_MEMBERS_TITLE_LENGTH,
    ),
    membersSubtitle: normalizeMembersText(
      input.membersSubtitle ?? null,
      MAX_MEMBERS_SUBTITLE_LENGTH,
    ),
    membersDescription: normalizeMembersText(
      input.membersDescription ?? null,
      MAX_MEMBERS_DESCRIPTION_LENGTH,
    ),
    communityEnabled: input.communityEnabled === true,
  };

  const { error } = await supabase.rpc("update_teacher_course_builder", {
    p_course_id: courseId,
    p_payload: payload as unknown as Json,
  });

  if (error) {
    throw error;
  }
}

export async function publishTeacherCourse(courseId: string) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("publish_teacher_course", {
    p_course_id: courseId,
  });

  if (error) {
    throw error;
  }
}

export async function deleteTeacherCourse(courseId: string) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("delete_teacher_course_draft", {
    p_course_id: courseId,
  });

  if (error) {
    throw error;
  }
}

export async function deleteCourseAsAdmin(courseId: string) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("delete_course_as_admin", {
    p_course_id: courseId,
  });

  if (error) {
    throw error;
  }
}

/**
 * Editorial review decision, ops/admin only. `status` is a frozen column but the
 * courses freeze trigger allows is_ops()/is_admin() writes, and courses UPDATE
 * RLS restricts this to ops/admin — a teacher cannot flip their own review
 * status. reviewNote is not a frozen column.
 */
export async function updateCourseReviewStatus(
  courseId: string,
  status: Extract<TeacherCourseStatus, "published" | "needs_changes" | "inactive">,
  reviewNote: string | null = null,
) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from(coursesTable)
    .update({
      status,
      review_note: reviewNote?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", courseId);

  if (error) {
    throw error;
  }
}

/**
 * Editorial curation toggle, ops/admin only. `featured` + `featured_rank` are
 * frozen columns; the courses freeze trigger allows ops/admin writes and RLS
 * scopes the row update to ops/admin, so a teacher saving their own course
 * cannot self-feature. Passing `featured = false` clears the rank too, so an
 * unfeatured course never carries a stale placement.
 */
export async function setCourseFeatured(
  courseId: string,
  featured: boolean,
  featuredRank: number | null = null,
) {
  const supabase = getSupabaseBrowserClient();
  const rank = featured
    ? typeof featuredRank === "number" && Number.isFinite(featuredRank)
      ? Math.max(0, Math.round(featuredRank))
      : null
    : null;

  const { error } = await supabase
    .from(coursesTable)
    .update({
      featured,
      featured_rank: rank,
      updated_at: new Date().toISOString(),
    })
    .eq("id", courseId);

  if (error) {
    throw error;
  }
}

export function subscribeToTeacherCourse(
  courseId: string,
  callback: (course: TeacherCourse | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(coursesTable)
      .select("*")
      .eq("id", courseId)
      .maybeSingle();

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(data ? rowToTeacherCourse(data) : null);
  };

  void load();

  const channel = supabase
    .channel(`courses:builder:${courseId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: coursesTable,
        filter: `id=eq.${courseId}`,
      },
      (payload) => {
        if (payload.eventType === "DELETE") {
          callback(null);
          return;
        }
        callback(rowToTeacherCourse(payload.new as unknown as CourseRow));
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToTeacherCourses(
  ownerId: string,
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(coursesTable)
      .select("*")
      .eq("owner_id", ownerId);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToTeacherCourse));
  };

  void load();

  const channel = supabase
    .channel(`courses:owner:${ownerId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: coursesTable,
        filter: `owner_id=eq.${ownerId}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToCoursesInReview(
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(coursesTable)
      .select("*")
      .eq("status", "in_review");

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToTeacherCourse));
  };

  void load();

  const channel = supabase
    .channel("courses:in_review")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: coursesTable,
        filter: "status=eq.in_review",
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToManagedCourses(
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(coursesTable)
      .select("*")
      .in("status", ["published", "inactive"]);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback((data ?? []).map(rowToTeacherCourse));
  };

  void load();

  // Realtime server filters only support a single-column eq, not `in`, so watch
  // the whole table and re-run the filtered query on any change.
  // ponytail: table-wide change fan-in; the status filter is applied in load().
  const channel = supabase
    .channel("courses:managed")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: coursesTable },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
