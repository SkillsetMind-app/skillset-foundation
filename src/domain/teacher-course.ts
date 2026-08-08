import type { DripStrategy } from "@/domain/drip-policy";

export const skillsetCourseCategories = [
  "Clinical Psychology & Approaches",
  "Hypnotherapy",
  "Integrative & Holistic Therapies",
  "Family Constellations & Systemic Work",
  "Mental Health Foundations",
  "Personal Development",
  "The Therapist's Business",
  "Supervision & Continuing Education",
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

export type TeacherCourseProductFormat =
  | "course"
  | "program"
  | "subscription"
  | "community"
  | "event"
  | "free";

export type TeacherCourseSubscriptionInterval = "monthly" | "yearly";

export function resolveTeacherCoursePaymentType(
  format: TeacherCourseProductFormat,
  interval: TeacherCourseSubscriptionInterval
): TeacherCoursePaymentType {
  if (format === "free") {
    return "free";
  }

  if (format === "subscription" || format === "community") {
    return interval === "yearly" ? "subscription_yearly" : "subscription_monthly";
  }

  return "one_time";
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

/**
 * A teacher may permanently delete a course only while it is fully under their
 * own control and has never reached the marketplace: drafts and
 * needs-changes courses. Legacy in-review, published, and inactive courses may
 * carry marketplace state, enrollments, or sales and must not be hard-deleted here.
 */
export function teacherCanDeleteCourse(status: TeacherCourseStatus): boolean {
  return ["draft", "needs_changes"].includes(status);
}

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
