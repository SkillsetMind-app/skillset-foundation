import type { DripStrategy } from "@/domain/drip-policy";

// Deliberately free of US-regulated vocabulary. "Therapist", "psychologist",
// "counselor" and "clinical" are protected titles or scope-of-practice terms in
// all 50 states, and "school"/"academy" trigger state education-agency
// licensure — so none of them may name a category a seller picks to describe
// what they sell. Psychology survives as a SUBJECT ("Applied Psychology"),
// never as an identity a seller picks. The marketing copy is a separate
// decision and does name psychologists as the audience (owner's call,
// 2026-08-29); src/data/i18n/regulated-wording.test.ts still fails the build
// if the interface calls anyone a therapist or counselor. The category column is free text (max 80 chars, see
// 20260716000100_live_teacher_course_rpcs.sql), so renaming here needs no
// migration; it only changes the picker.
export const skillsetCourseCategories = [
  "Applied Psychology & Behavior",
  "Hypnosis & Guided Change",
  "Integrative & Holistic Practices",
  "Family Constellations & Systemic Work",
  "Emotional Resilience & Wellbeing",
  "Personal Development",
  "Coaching as a Business",
  "Mentorship & Professional Growth",
] as const;

export type TeacherCourseStatus =
  | "draft"
  | "in_review"
  | "needs_changes"
  | "published"
  | "inactive";

export type LessonType =
  | "video"
  | "text"
  | "quiz"
  | "assignment"
  | "live_recording"
  | "download"
  | "external_embed";

export type TeacherCoursePaymentType =
  | "one_time"
  | "subscription_monthly"
  | "subscription_yearly"
  | "free";

// What the product delivers, stored in courses.product_format. It decides what
// the builder shows and what publishing charges for (getCourseReadiness here and
// publish_teacher_course in the database). "Guided program" became the
// invite-only release of the course; "Free" and "Subscription" are answers of the price step.
export const teacherCourseProductFormats = ["course", "community", "live_event", "ebook"] as const;

export type TeacherCourseProductFormat = (typeof teacherCourseProductFormats)[number];

// Old links (?format=program, event, free, subscription) and a row without the
// column fall to the type that absorbed them.
export function parseTeacherCourseProductFormat(value: unknown): TeacherCourseProductFormat {
  if (value === "event") {
    return "live_event";
  }

  return teacherCourseProductFormats.includes(value as TeacherCourseProductFormat)
    ? (value as TeacherCourseProductFormat)
    : "course";
}

// Community starts out as a monthly fee; the rest as a one-time payment. The
// price step changes it later (including to Free).
export function defaultPaymentTypeForProductFormat(
  format: TeacherCourseProductFormat,
): TeacherCoursePaymentType {
  return format === "community" ? "subscription_monthly" : "one_time";
}

// The ways to pay that each type accepts. Event and e-book do not charge every
// month; a community is not sold as a one-time payment. The database enforces the same
// list on create, save, publish and creating an extra price
// (course_payment_type_fits_format, 20261007030000_como_vao_pagar.sql).
const paymentTypesByProductFormat: Record<
  TeacherCourseProductFormat,
  readonly TeacherCoursePaymentType[]
> = {
  course: ["free", "one_time", "subscription_monthly", "subscription_yearly"],
  community: ["free", "subscription_monthly", "subscription_yearly"],
  live_event: ["free", "one_time"],
  ebook: ["free", "one_time"],
};

export function paymentTypeFitsFormat(
  format: TeacherCourseProductFormat,
  paymentType: TeacherCoursePaymentType,
): boolean {
  return paymentTypesByProductFormat[format].includes(paymentType);
}

export type MembersTheme = "light" | "dark";

export type LessonVideoSource = "youtube" | "upload";

export type TeacherLesson = {
  id: string;
  title: string;
  type: LessonType;
  description: string;
  durationMinutes?: number | null;
  contentText?: string | null;
  externalUrl?: string | null;
  videoSource?: LessonVideoSource | null;
  dripDelayDays?: number | null;
  thumbnailAssetId?: string | null;
};

export type TeacherCourseModule = {
  id: string;
  title: string;
  summary?: string | null;
  coverAssetId?: string | null;
  lessons: TeacherLesson[];
};

export type TeacherCourse = {
  id: string;
  ownerId: string;
  title: string;
  titleKey?: string;
  summary: string;
  category: string;
  categories?: string[];
  learningOutcomes?: string[];
  productFormat?: TeacherCourseProductFormat;
  status: TeacherCourseStatus;
  modules: TeacherCourseModule[];
  lessonCount: number;
  priceAmountMinor?: number | null;
  currency?: string;
  paymentType?: TeacherCoursePaymentType;
  installmentsEnabled?: boolean;
  installmentsMax?: number | null;
  platformFeeBps?: number;
  dripStrategy?: DripStrategy;
  dripIntervalDays?: number | null;
  freePreviewLessonId?: string | null;
  coverImageUrl?: string | null;
  // Per-course members-area customization (the enrolled-student hero). All
  // optional/nullable — a course with none set falls back to membersTheme
  // "dark" (the design default) and the course's own title/cover.
  membersTheme?: MembersTheme | null;
  membersCoverAssetId?: string | null;
  membersTitle?: string | null;
  membersSubtitle?: string | null;
  membersDescription?: string | null;
  // Teacher opt-in: the course community (feed inside the members area) only
  // exists for students when this is true. Defaults off for new courses.
  communityEnabled?: boolean;
  reviewNote?: string | null;
  ratingAverage?: number;
  ratingCount?: number;
  reviewCount?: number;
  // Editorial marketplace curation, set by the operations team only (gated
  // server-side — teachers cannot self-feature).
  // `featured` pins the course to the top of the catalog; `featuredRank` orders
  // featured courses among themselves (lower = higher placement).
  featured?: boolean;
  featuredRank?: number | null;
  // Server-only popularity signals (Admin SDK writes only; absent from every
  // teacher courseChangedOnly list). `enrollmentCount` = lifetime enrollments
  // (onEnrollmentCreated trigger); `trendingScore` = enrollments in the last 7
  // days (rebuildTrending schedule). Feed the marketplace "Trending now" sort.
  enrollmentCount?: number;
  trendingScore?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type CreateTeacherCourseInput = {
  ownerId: string;
  title: string;
  summary: string;
  category: string;
  categories?: string[];
  paymentType?: TeacherCoursePaymentType;
  communityEnabled?: boolean;
  productFormat?: TeacherCourseProductFormat;
  // Course and e-book start out with the first module and the first lesson, with these
  // names (in the person's language).
  moduleTitle?: string;
  lessonTitle?: string;
};

export type UpdateTeacherCourseBuilderInput = {
  title: string;
  summary: string;
  category: string;
  categories?: string[];
  learningOutcomes: string[];
  modules: TeacherCourseModule[];
  priceAmountMinor: number | null;
  currency: string;
  paymentType: TeacherCoursePaymentType;
  installmentsEnabled: boolean;
  installmentsMax: number | null;
  platformFeeBps: number;
  dripStrategy: DripStrategy;
  dripIntervalDays: number | null;
  freePreviewLessonId: string | null;
  membersTheme?: MembersTheme | null;
  membersCoverAssetId?: string | null;
  membersTitle?: string | null;
  membersSubtitle?: string | null;
  membersDescription?: string | null;
  communityEnabled?: boolean;
};

export function countCourseLessons(modules: TeacherCourseModule[]): number {
  return modules.reduce((total, module) => total + module.lessons.length, 0);
}

// Total duration of the lessons, in the sales page format ("1h 30m", "25 min").
// Only when ALL lessons declare minutes: if some of them lack the data, the sum
// becomes a total smaller than the course (17 lessons shown as "10 min"). Course
// time is not estimated. Works for the whole course and for each module.
export function formatTotalMinutes(minutes: Array<number | null | undefined>): string | null {
  if (minutes.length === 0 || minutes.some((value) => !value || value <= 0)) return null;
  const total = minutes.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return total >= 60 ? `${Math.floor(total / 60)}h${total % 60 ? ` ${total % 60}m` : ""}` : `${total} min`;
}

export function normalizeCourseCategories(categories: string[] = []): string[] {
  const seen = new Set<string>();

  return categories
    .map((category) => category.trim())
    .filter((category) => {
      if (!category) {
        return false;
      }

      const key = category.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

export const MAX_LEARNING_OUTCOMES = 8;
export const MAX_LEARNING_OUTCOME_LENGTH = 120;

// Shared by the builder (live payload + change-signature) and the public
// course-page mapper, so the teacher sees exactly what students will see.
// The Cloud Function keeps its own copy (separate runtime) with identical rules.
export function normalizeLearningOutcomes(outcomes: unknown): string[] {
  if (!Array.isArray(outcomes)) {
    return [];
  }

  const normalized: string[] = [];

  for (const outcome of outcomes) {
    if (typeof outcome !== "string") {
      continue;
    }

    const value = outcome.trim();

    if (!value) {
      continue;
    }

    normalized.push(value.slice(0, MAX_LEARNING_OUTCOME_LENGTH));

    if (normalized.length >= MAX_LEARNING_OUTCOMES) {
      break;
    }
  }

  return normalized;
}

export const MAX_MEMBERS_TITLE_LENGTH = 80;
export const MAX_MEMBERS_SUBTITLE_LENGTH = 160;
export const MAX_MEMBERS_DESCRIPTION_LENGTH = 2000;

// Members-area hero customization. Theme accepts only the two literals (else
// null → caller defaults to "dark"); text fields trim and cap to mirror the
// builder's existing input limits. The Cloud Function keeps its own copy.
export function normalizeMembersTheme(value: unknown): MembersTheme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function normalizeMembersText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const nextValue = value.trim();
  return nextValue ? nextValue.slice(0, maxLength) : null;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const nextValue = value?.trim();
  return nextValue ? nextValue : null;
}

function normalizeNullableNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function normalizeVideoSource(value: unknown): LessonVideoSource | null {
  return value === "youtube" || value === "upload" ? value : null;
}

export function inferLessonVideoSource(params: {
  hasVideoAsset: boolean;
  hasTrustedEmbed: boolean;
}): LessonVideoSource | null {
  if (params.hasVideoAsset) {
    return "upload";
  }

  if (params.hasTrustedEmbed) {
    return "youtube";
  }

  return null;
}

// The declared source only counts while the media it promises still exists.
//
// `videoSource` is a persisted field, and every persisted field drifts away from
// the world sooner or later: the teacher deletes the uploaded file and the field
// keeps saying "upload"; swaps the YouTube link for an invalid one and the field
// keeps saying "youtube". Whoever read the raw field fell into the void — "Media not attached
// yet" on a paid lesson that still had a valid embed saved and never consulted.
//
// So the decision is made HERE, once, and not in each reader: check the
// declared source against the evidence and, when it does not hold up, fall back to
// what actually exists. This heals data already stored wrong on its own — it does not
// depend on every writer having done the cleanup at the right time.
export function resolveLessonVideoSource(params: {
  declared?: LessonVideoSource | null;
  hasVideoAsset: boolean;
  hasTrustedEmbed: boolean;
}): LessonVideoSource | null {
  if (params.declared === "upload" && params.hasVideoAsset) {
    return "upload";
  }

  if (params.declared === "youtube" && params.hasTrustedEmbed) {
    return "youtube";
  }

  return inferLessonVideoSource(params);
}

// Serialize the builder's modules for the course-doc payload. contentText /
// externalUrl are always kept (trimmed) so the Cloud Function receives the real
// lesson content and can mirror it into the gated lessonContent subcollection;
// the function alone decides — via its own WRITE_LESSON_CONTENT_INLINE flag —
// whether to also keep the content inline on the world-readable course doc.
export function normalizeTeacherCourseModules(
  modules: TeacherCourseModule[]
): TeacherCourseModule[] {
  return modules.map((module) => ({
    ...module,
    title: module.title.trim(),
    summary: normalizeNullableText(module.summary),
    coverAssetId: normalizeNullableText(module.coverAssetId),
    lessons: module.lessons.map((lesson) => ({
      ...lesson,
      title: lesson.title.trim(),
      description: lesson.description.trim(),
      durationMinutes: normalizeNullableNumber(lesson.durationMinutes),
      contentText: normalizeNullableText(lesson.contentText),
      externalUrl: normalizeNullableText(lesson.externalUrl),
      videoSource: normalizeVideoSource(lesson.videoSource),
      dripDelayDays:
        typeof lesson.dripDelayDays === "number"
          ? Math.max(0, Math.round(lesson.dripDelayDays))
          : null,
      thumbnailAssetId: normalizeNullableText(lesson.thumbnailAssetId),
    })),
  }));
}

export function normalizeInstallmentsMax(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(36, Math.max(1, Math.round(value)));
}

export function teacherCanEditCourse(status: TeacherCourseStatus): boolean {
  return ["draft", "needs_changes", "published", "inactive"].includes(status);
}

export function teacherCanPublishCourse(status: TeacherCourseStatus): boolean {
  return ["draft", "in_review", "needs_changes", "inactive"].includes(status);
}

export function isCoursePubliclySellable(status: string | null | undefined): boolean {
  return status === "published";
}

// Internal test courses stay published so the real pipelines can be exercised
// end to end, and stay reachable by direct URL — but they never surface in the
// store, the homepage, instructor pages or the sitemap. Two conventions mark
// them: live-checkout smoke tests use a `smoke-` id, and access-matrix QA
// courses carry a "[QA]" title prefix. Plain module (no "use client") so the
// server-side sitemap and the client store share this one predicate; the SQL
// version (hasRealPublishedCourse) reads the same two prefixes.
export const INTERNAL_COURSE_ID_PREFIX = "smoke-";
export const INTERNAL_COURSE_TITLE_PREFIX = "[QA]";

export function isInternalSmokeCourse(course: Pick<TeacherCourse, "id" | "title">): boolean {
  return course.id.startsWith(INTERNAL_COURSE_ID_PREFIX)
    || course.title.startsWith(INTERNAL_COURSE_TITLE_PREFIX);
}

// `teacherCanDeleteCourse` died here: what decides between deleting and archiving
// is no longer the status, but whether there is a buyer — a question only the database
// answers, inside `delete_or_archive_own_course`.

/**
 * Admin-only marketplace controls for courses that have left the review
 * pipeline. Unpublishing takes a live course off the marketplace
 * (published -> inactive); republishing restores it (inactive -> published).
 * Both are reversible status flips with no data loss.
 */
export function adminCanUnpublishCourse(status: TeacherCourseStatus): boolean {
  return status === "published";
}

export function adminCanRepublishCourse(status: TeacherCourseStatus): boolean {
  return status === "inactive";
}
