"use client";

import type { DripStrategy } from "@/domain/drip-policy";
import { DEFAULT_PLATFORM_FEE_BPS } from "@/lib/payments/rules";
import type { TeacherCourse, TeacherCourseModule, TeacherCourseStatus, TeacherCoursePaymentType, MembersTheme } from "@/domain/teacher-course";
import {
  normalizeLearningOutcomes,
  normalizeMembersText,
  normalizeMembersTheme,
  MAX_MEMBERS_DESCRIPTION_LENGTH,
  MAX_MEMBERS_SUBTITLE_LENGTH,
  MAX_MEMBERS_TITLE_LENGTH,
} from "@/domain/teacher-course";
import type { Course } from "@/domain/learning";
import type { CourseCard } from "@/lib/data/catalog";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

const coursesTable = "courses";

type CourseRow = Database["public"]["Tables"]["courses"]["Row"];

// Internal live-checkout smoke-test courses (priced at $1, used to verify the
// real Stripe pipeline end to end) are published under a deliberate `smoke-`
// id prefix. They must stay reachable by direct URL, but never surface in
// browse or instructor storefront lists.
export function isInternalSmokeCourse(course: Pick<TeacherCourse, "id">): boolean {
  return course.id.startsWith("smoke-");
}

// Public course URLs use `title_key` — the unique, unaccented, hyphenated key
// Postgres already derives from the title (public.course_title_key) on create
// and on rename, with uniqueness enforced by the RPC. No new column and no
// backfill: the pretty slug has been sitting in the row all along. Rows written
// before title_key existed fall back to the id, which stays a valid URL.
export function courseUrlSlug(course: Pick<TeacherCourse, "id" | "titleKey">): string {
  return course.titleKey || course.id;
}

export function rowToTeacherCourse(row: CourseRow): TeacherCourse {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    titleKey: row.title_key ?? undefined,
    summary: row.summary,
    category: row.category,
    categories: (row.categories as string[] | null) ?? undefined,
    learningOutcomes: (row.learning_outcomes as string[] | null) ?? undefined,
    status: row.status as TeacherCourseStatus,
    modules: (row.modules as unknown as TeacherCourseModule[]) ?? [],
    lessonCount: row.lesson_count,
    priceAmountMinor: row.price_amount_minor,
    currency: row.currency ?? undefined,
    paymentType: (row.payment_type as TeacherCoursePaymentType) ?? undefined,
    installmentsEnabled: row.installments_enabled ?? undefined,
    installmentsMax: row.installments_max ?? undefined,
    platformFeeBps: row.platform_fee_bps ?? undefined,
    dripStrategy: (row.drip_strategy as DripStrategy) ?? undefined,
    dripIntervalDays: row.drip_interval_days ?? undefined,
    freePreviewLessonId: row.free_preview_lesson_id ?? undefined,
    coverImageUrl: row.cover_image_url ?? undefined,
    membersTheme: (row.members_theme as MembersTheme | null) ?? undefined,
    membersCoverAssetId: row.members_cover_asset_id ?? undefined,
    membersTitle: row.members_title ?? undefined,
    membersSubtitle: row.members_subtitle ?? undefined,
    membersDescription: row.members_description ?? undefined,
    communityEnabled: row.community_enabled,
    reviewNote: row.review_note ?? undefined,
    ratingAverage: row.rating_average ?? undefined,
    ratingCount: row.rating_count ?? undefined,
    reviewCount: row.review_count ?? undefined,
    featured: row.featured ?? undefined,
    featuredRank: row.featured_rank ?? undefined,
    enrollmentCount: row.enrollment_count ?? undefined,
    trendingScore: row.trending_score ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function subscribeToPublishedTeacherCourses(
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void,
): () => void {
  // Only approved courses are public. Draft and review states stay in Studio.
  // Bounded: every public catalog visitor streams this query, and each row
  // carries the FULL course (modules + lesson contentText), so an unbounded
  // read scales cost with the whole marketplace. 200 covers the catalog for
  // the foreseeable horizon; past that the fix is a slim "courseCards"
  // projection + pagination, not a bigger limit.
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(coursesTable)
      .select("*")
      .eq("status", "published")
      .limit(200);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(
      (data ?? [])
        .map(rowToTeacherCourse)
        .sort((left, right) => left.title.localeCompare(right.title)),
    );
  };

  void load();

  // Realtime server filters only support a single-column eq, not `in`, so watch
  // the whole table and re-run the filtered query on any change.
  // ponytail: table-wide change fan-in; fine for the public catalog list (status filter is applied in load()).
  const channel = supabase
    .channel("courses:published")
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

export function subscribeToPublishedTeacherCoursesByOwner(
  ownerId: string,
  callback: (courses: TeacherCourse[]) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();

  const load = async () => {
    const { data, error } = await supabase
      .from(coursesTable)
      .select("*")
      .eq("owner_id", ownerId)
      .eq("status", "published")
      .limit(48);

    if (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    callback(
      (data ?? [])
        .map(rowToTeacherCourse)
        .sort((left, right) => left.title.localeCompare(right.title)),
    );
  };

  void load();

  const channel = supabase
    .channel(`courses:published:owner:${ownerId}`)
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

/**
 * Subscribe to a single course row for the public course-detail surface.
 * Unlike the catalog list, this does NOT filter by published status: Postgres
 * RLS already gates reads to the public (published courses) plus the course
 * owner and admins. Returning the raw row lets the detail view tell an
 * owner/admin that their not-yet-public course is awaiting approval instead of
 * showing a generic dead-end. A non-authorized reader of an unpublished course
 * is rejected by RLS and surfaces through `onError`.
 */
export function subscribeToViewableTeacherCourse(
  courseRef: string,
  callback: (course: TeacherCourse | null) => void,
  onError: (error: Error) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  let cancelled = false;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  // `courseRef` is a URL segment, so it is either a course id (every link
  // minted before pretty URLs — including the Stripe checkout redirects, which
  // hardcode the id) or a title_key slug. Id is tried first, so a course whose
  // title happens to slugify into another course's id can never shadow it.
  // Two `.eq()` round-trips instead of one `.or()`: the segment is untrusted
  // input and PostgREST's `or` filter is a string grammar, so building it from
  // a URL segment would be an injection surface for one saved request.
  const resolve = async (): Promise<CourseRow | null> => {
    const byId = await supabase
      .from(coursesTable)
      .select("*")
      .eq("id", courseRef)
      .maybeSingle();
    if (byId.error) throw byId.error;
    if (byId.data) return byId.data;

    // title_key uniqueness is enforced by the create/rename RPCs rather than a
    // DB constraint, so take the first match instead of maybeSingle() — a
    // duplicate should never render an error page.
    const bySlug = await supabase
      .from(coursesTable)
      .select("*")
      .eq("title_key", courseRef)
      .limit(1);
    if (bySlug.error) throw bySlug.error;
    return bySlug.data?.[0] ?? null;
  };

  void resolve()
    .then((row) => {
      if (cancelled) return;
      callback(row ? rowToTeacherCourse(row) : null);
      if (!row) return;

      // Realtime filters match on the primary key, so subscribe with the
      // resolved id — never the slug the visitor typed.
      channel = supabase
        .channel(`courses:one:${row.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: coursesTable,
            filter: `id=eq.${row.id}`,
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
    })
    .catch((error: unknown) => {
      if (cancelled) return;
      onError(error instanceof Error ? error : new Error(String(error)));
    });

  return () => {
    cancelled = true;
    if (channel) {
      void supabase.removeChannel(channel);
    }
  };
}

export function teacherCourseToCourseCard(course: TeacherCourse): CourseCard {
  const priceLabel =
    typeof course.priceAmountMinor === "number"
      ? new Intl.NumberFormat("en", {
          style: "currency",
          currency: course.currency ?? "USD",
        }).format(course.priceAmountMinor / 100)
      : "Enrollment opening soon";
  const hasFreePreview = Boolean(course.freePreviewLessonId);
  const ratingLabel =
    course.ratingCount && course.ratingAverage
      ? `${course.ratingAverage.toFixed(1)} rating (${course.ratingCount})`
      : "New course";

  const urlSlug = courseUrlSlug(course);

  return {
    slug: urlSlug,
    title: course.title,
    category: course.category,
    duration: `${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"}`,
    status: "Creator course",
    summary: course.summary,
    image: course.coverImageUrl
      || "/brand/logo-mark.png",
    detail: "Created by an approved SkillsetMind educator.",
    priceLabel,
    freePreviewLabel: hasFreePreview
      ? "Free preview selected"
      : "Preview coming soon",
    hasPaidAccess: false,
    href: `/courses/${urlSlug}`,
    freePreviewHref: hasFreePreview
      ? `/courses/${urlSlug}#free-preview`
      : undefined,
    sourceLabel: "Teacher published",
    ratingLabel,
    ownerId: course.ownerId,
    currency: course.currency ?? "USD",
    lessonCount: course.lessonCount,
    // Raw signals for marketplace sorting (price / rating). Display strings
    // above stay the source of truth for rendering; these feed comparators only.
    priceAmountMinor: course.priceAmountMinor ?? null,
    ratingAverage: course.ratingAverage,
    ratingCount: course.ratingCount,
    featured: course.featured ?? false,
    featuredRank: course.featuredRank ?? null,
    trendingScore: course.trendingScore ?? 0,
    enrollmentCount: course.enrollmentCount ?? 0,
  };
}

export function teacherCourseToLearningCourse(course: TeacherCourse): Course {
  const priceLabel =
    typeof course.priceAmountMinor === "number"
      ? new Intl.NumberFormat("en", {
          style: "currency",
          currency: course.currency ?? "USD",
        }).format(course.priceAmountMinor / 100)
      : "Enrollment opening soon";
  const hasFreePreview = Boolean(course.freePreviewLessonId);
  const teacherOutcomes = normalizeLearningOutcomes(course.learningOutcomes);

  return {
    id: course.id,
    slug: course.id,
    title: course.title,
    category: course.category,
    instructorId: course.ownerId,
    durationLabel: `${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"}`,
    status: "published",
    statusLabel: "Published",
    summary: course.summary,
    detail: "This private workspace is connected to a teacher-published SkillsetMind course.",
    image: course.coverImageUrl
      || "/brand/logo-mark.png",
    level: "Professional",
    priceLabel,
    priceAmountMinor: course.priceAmountMinor ?? null,
    currency: course.currency ?? "USD",
    platformFeeBps: course.platformFeeBps ?? DEFAULT_PLATFORM_FEE_BPS,
    dripStrategy: course.dripStrategy ?? "instant",
    dripIntervalDays: course.dripIntervalDays ?? 1,
    freePreviewLabel: hasFreePreview
      ? "Free preview selected"
      : "Preview coming soon",
    outcomes:
      teacherOutcomes.length > 0
        ? teacherOutcomes
        : [
            "Complete the teacher-defined lesson path.",
            "Use course events and community spaces to support progress.",
            "Track completion toward SkillsetMind credential eligibility.",
          ],
    modules: course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      summary:
        module.summary
        || `${module.lessons.length} lesson${module.lessons.length === 1 ? "" : "s"}`,
      lessons: module.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        type: lesson.type,
        duration: lesson.durationMinutes
          ? `${lesson.durationMinutes} min`
          : "Self-paced",
        isPreview: lesson.id === course.freePreviewLessonId,
        description: lesson.description,
        contentText: lesson.contentText ?? null,
        externalUrl: lesson.externalUrl ?? null,
        videoSource: lesson.videoSource ?? null,
        dripDelayDays: lesson.dripDelayDays ?? null,
      })),
    })),
    communityEnabled: course.communityEnabled ?? false,
    membersTheme: normalizeMembersTheme(course.membersTheme),
    membersCoverAssetId: normalizeMembersText(course.membersCoverAssetId, 160),
    membersTitle: normalizeMembersText(course.membersTitle, MAX_MEMBERS_TITLE_LENGTH),
    membersSubtitle: normalizeMembersText(
      course.membersSubtitle,
      MAX_MEMBERS_SUBTITLE_LENGTH,
    ),
    membersDescription: normalizeMembersText(
      course.membersDescription,
      MAX_MEMBERS_DESCRIPTION_LENGTH,
    ),
  };
}
