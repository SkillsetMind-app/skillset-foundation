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
import { getMyCourseStudents } from "@/lib/data/enrollments";
import { rowToTeacherCourse } from "@/lib/data/published-courses";
import { resolveLessonContent } from "@/lib/data/lesson-content";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { observeLessonVideoSelections, reconcileLessonVideoSelections, runCourseWrite } from "./course-write-queue";

const coursesTable = "courses";

// createTeacherCourseDraft callable → create_teacher_course_draft RPC
// (SECURITY DEFINER): enforces the teacher/terms gate, rate limit, and title-key
// uniqueness server-side, then inserts the draft with a plan-derived platform
// fee, the product type and (course, e-book) the first module and lesson.
// Returns the new course id.
export async function createTeacherCourse(input: CreateTeacherCourseInput) {
  const supabase = getSupabaseBrowserClient();
  const paymentType = input.paymentType ?? "one_time";
  const categories = normalizeCourseCategories([...(input.categories ?? []), input.category]);

  const { data, error } = await supabase.rpc("create_teacher_course_draft", {
    p_title: input.title,
    p_summary: input.summary,
    p_category: categories[0] ?? input.category,
    p_categories: categories,
    p_payment_type: paymentType,
    p_community_enabled: input.communityEnabled === true,
    p_product_format: input.productFormat ?? "course",
    p_module_title: input.moduleTitle ?? "",
    p_lesson_title: input.lessonTitle ?? "",
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
  input: UpdateTeacherCourseBuilderInput
) {
  const supabase = getSupabaseBrowserClient();
  const categories = normalizeCourseCategories([...(input.categories ?? []), input.category]);

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
    membersCoverAssetId: normalizeMembersText(input.membersCoverAssetId ?? null, 160),
    membersTitle: normalizeMembersText(input.membersTitle ?? null, MAX_MEMBERS_TITLE_LENGTH),
    membersSubtitle: normalizeMembersText(
      input.membersSubtitle ?? null,
      MAX_MEMBERS_SUBTITLE_LENGTH
    ),
    membersDescription: normalizeMembersText(
      input.membersDescription ?? null,
      MAX_MEMBERS_DESCRIPTION_LENGTH
    ),
    communityEnabled: input.communityEnabled === true,
  };

  await runCourseWrite(courseId, async () => {
    payload.modules = reconcileLessonVideoSelections(courseId, payload.modules);
    const { error } = await supabase.rpc("update_teacher_course_builder", {
      p_course_id: courseId,
      p_payload: payload as unknown as Json,
    });
    if (error) throw error;
  });
}

export async function publishTeacherCourse(courseId: string) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("publish_teacher_course", {
    p_course_id: courseId,
  });

  if (error) {
    throw Object.assign(new Error(error.message), error);
  }
}

export type DeleteOrArchiveOutcome = {
  outcome: "deleted" | "archived";
  enrollments?: number;
  orders?: number;
};

/**
 * One action, two outcomes, decided on the server: `delete_or_archive_own_course`
 * deletes a course that never had an enrollment or an order and archives (status inactive)
 * one that did. Replaces `delete_teacher_course_draft`, which only accepted a draft
 * — the old RPC stays in the database for compatibility, the app no longer calls it.
 */
export async function deleteOrArchiveCourse(courseId: string): Promise<DeleteOrArchiveOutcome> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("delete_or_archive_own_course", {
    p_course_id: courseId,
  });

  if (error) {
    throw error;
  }

  return data as unknown as DeleteOrArchiveOutcome;
}

/**
 * How many buyers this course has, from the owner's point of view. Decides the TEXT of the modal
 * before the action; the real outcome is still the server's.
 *
 * The tables are read in different ways: the RLS of `enrollments` only returns the
 * learner's OWN row (that is why the roster RPC exists), while `orders` and
 * `course_subscriptions` have a read policy for the teacher
 * (`*_teacher_read`, 20260807120000). A subscription counts as a buyer: the
 * server archives a product with only a subscription, and the modal cannot promise to delete.
 *
 * ponytail: reuses the teacher's whole roster and counts in memory. Swap for
 * a `p_course_id` + LIMIT in `get_my_course_students` when someone passes the
 * 2,000-learner cap of the Pro plan — the same note the roster migration
 * already carries.
 */
export async function getCourseAudience(
  courseId: string
): Promise<{ enrollments: number; orders: number; subscriptions: number }> {
  const supabase = getSupabaseBrowserClient();
  const [students, orders, subscriptions] = await Promise.all([
    getMyCourseStudents(),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("course_id", courseId),
    supabase.from("course_subscriptions").select("id", { count: "exact", head: true }).eq("course_id", courseId),
  ]);

  if (orders.error) {
    throw orders.error;
  }
  if (subscriptions.error) {
    throw subscriptions.error;
  }

  return {
    enrollments: students.filter((student) => student.courseId === courseId).length,
    orders: orders.count ?? 0,
    subscriptions: subscriptions.count ?? 0,
  };
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
  reviewNote: string | null = null
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
  featuredRank: number | null = null
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

/**
 * Self-serve highlight, teacher's own courses only, metered by their plan.
 *
 * Separate from `setCourseFeatured` above on purpose: that one is the ops
 * curation path and can set an explicit rank. This one goes through the
 * `set_own_course_featured` RPC because `featured` is a frozen column — a
 * direct update from the browser always raises the freeze-trigger exception,
 * whatever the RLS policy says. The RPC owns the quota check, so the count
 * cannot be bypassed by calling this twice.
 *
 * Resolves with nothing: the caller reads the new state off its existing
 * realtime course subscription, not off this return value. The RPC's *error*
 * is what matters here — it carries the server's own quota wording.
 */
export async function setOwnCourseFeatured(courseId: string, featured: boolean): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("set_own_course_featured", {
    p_course_id: courseId,
    p_featured: featured,
  });

  if (error) {
    throw error;
  }
}

export function subscribeToTeacherCourse(
  courseId: string,
  callback: (course: TeacherCourse | null) => void,
  onError: (error: Error) => void
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();
  let cancelled = false;
  let generation = 0;

  // `quiet`: a standalone reload that fails keeps the course already on screen, instead of
  // replacing the whole builder with the error screen.
  const load = async (quiet = false) => {
    const current = ++generation;
    const { data, error } = await supabase
      .from(coursesTable)
      .select("*")
      .eq("id", courseId)
      .maybeSingle();

    if (cancelled || current !== generation) return;
    if (error) {
      if (quiet) {
        console.warn("Course reload failed; keeping the previous snapshot", error);
        return;
      }
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    if (!data) {
      callback(null);
      return;
    }

    // The public curriculum no longer carries paywalled content. Do not emit a
    // writable draft until this read succeeds: autosave would erase its text.
    const { data: content, error: contentError } = await supabase
      .from("course_lesson_content")
      .select("lesson_id,content_text,external_url")
      .eq("course_id", courseId);
    if (cancelled || current !== generation) return;
    if (contentError) {
      if (quiet) {
        console.warn("Course reload failed; keeping the previous snapshot", contentError);
        return;
      }
      onError(new Error(contentError.message));
      return;
    }
    const byLesson = new Map((content ?? []).map((row) => [row.lesson_id, {
      contentText: row.content_text,
      externalUrl: row.external_url,
    }]));
    const course = rowToTeacherCourse(data);
    observeLessonVideoSelections(courseId, course.modules, data.updated_at);
    callback({ ...course, modules: course.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        ...resolveLessonContent(byLesson.get(lesson.id), lesson),
      })),
    })) });
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
      () => { void load(); }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "course_lesson_content", filter: `course_id=eq.${courseId}` },
      () => { void load(); }
    )
    .subscribe();

  // `reload()` fetches again without touching the channel. The builder calls it after its
  // own autosave: knowing that the module/lesson was saved (and unlocking the upload
  // of the cover and the video) cannot depend on the Realtime echo arriving.
  return Object.assign(
    () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    },
    { reload: () => load(true) },
  );
}

/** Id, title and community of each of the teacher's products, in a single read:
 *  for screens that list by product (Learners, Inbox) without opening a
 *  realtime subscription to the whole course. */
export async function getMyCourseSummaries(
  ownerId: string,
): Promise<Array<{ id: string; title: string; communityEnabled: boolean }>> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from(coursesTable)
    .select("id, title, community_enabled")
    .eq("owner_id", ownerId);

  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    communityEnabled: row.community_enabled === true,
  }));
}

export function subscribeToTeacherCourses(
  ownerId: string,
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void
): (() => void) & { reload: () => Promise<void> } {
  const supabase = getSupabaseBrowserClient();
  // Only the newest read delivers: a "Try again" that comes back after the
  // re-read of a changed course would bring the old list.
  let active = true;
  let latestLoad = 0;

  const load = async () => {
    const thisLoad = ++latestLoad;
    const { data, error } = await supabase.from(coursesTable).select("*").eq("owner_id", ownerId);

    if (!active || thisLoad !== latestLoad) {
      return;
    }
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
      }
    )
    .subscribe();

  // `reload()` reads again WITHOUT touching the channel (the "Try again" of Home and
  // Media): without the gap between leaving and rejoining Realtime.
  return Object.assign(
    () => {
      active = false;
      void supabase.removeChannel(channel);
    },
    { reload: load },
  );
}

export function subscribeToCoursesInReview(
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase.from(coursesTable).select("*").eq("status", "in_review");

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
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToManagedCourses(
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void
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
    .on("postgres_changes", { event: "*", schema: "public", table: coursesTable }, () => {
      void load();
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
