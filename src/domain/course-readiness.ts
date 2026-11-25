import { activationFeeUsd } from "@/data/plans";
import { isVideoAssetKind, type CourseAsset } from "@/domain/course-asset";
import { getSafeExternalUrl } from "@/domain/external-url";
import { getTrustedLessonEmbed } from "@/domain/lesson-embed";
import {
  countCourseLessons,
  normalizeCourseCategories,
  paymentTypeFitsFormat,
  type TeacherCourse,
  type TeacherCourseModule,
} from "@/domain/teacher-course";

// What the person suffered: the builder had TWO lists of "what is missing to
// publish" (Publish tab and footer) and Manage a THIRD, each with its own
// rule. For the same course the chip said 71%, the bar in the same header
// measured stages (40%) and Manage, which required payouts, showed 50%. Here lives
// the single rule, the strictest of the three, and every screen reads from here.

export type CourseReadinessInput = Pick<
  TeacherCourse,
  | "title"
  | "summary"
  | "category"
  | "categories"
  | "modules"
  | "priceAmountMinor"
  | "currency"
  | "paymentType"
  | "installmentsEnabled"
  | "installmentsMax"
  | "coverImageUrl"
  | "learningOutcomes"
  | "productFormat"
  | "communityEnabled"
> & {
  // Lessons with content (see getLessonIdsWithMedia). Whoever does not have the list of
  // files (Manage) does not pass: the item disappears and the percentage does not change.
  lessonIdsWithMedia?: ReadonlySet<string>;
  // Live event: scheduled sessions that are still to come in course_events.
  // E-book: files in a lesson of the product (countLessonFiles). Same rule as for
  // whoever does not know: the item disappears.
  scheduledSessionCount?: number;
  lessonFileCount?: number;
};

// Lesson with content. The SAME rule as the "lessons without content" notice in the panel
// (getCourseMaintenanceIssues, which calls this function) and the studio's Done badge:
// - uploaded video;
// - link: the YouTube/Vimeo one plays in the lesson, and an old link (Drive etc.) becomes the
//   learner's "Open resource" button, so it also counts;
// - lesson text or the old description (legacy text lesson);
// - at least one material file: a lesson with only a PDF is a valid lesson.
// Without this, a course could be published and sold with empty lessons.
export function getLessonIdsWithMedia(
  modules: Pick<TeacherCourseModule, "lessons">[],
  assets: Pick<CourseAsset, "kind" | "lessonId">[],
): Set<string> {
  const ids = new Set<string>();
  for (const asset of assets) {
    if (asset.lessonId && (isVideoAssetKind(asset.kind) || asset.kind === "lesson_material")) {
      ids.add(asset.lessonId);
    }
  }
  for (const courseModule of modules) {
    for (const lesson of courseModule.lessons) {
      if (
        getTrustedLessonEmbed(lesson.externalUrl)
        || getSafeExternalUrl(lesson.externalUrl)
        || lesson.contentText?.trim()
        || lesson.description?.trim()
      ) {
        ids.add(lesson.id);
      }
    }
  }
  return ids;
}

// Files (lesson_material) attached to a lesson of the product: that is where the buyer
// downloads them. A file from a deleted lesson does not count. Same rule as publish_teacher_course.
export function countLessonFiles(
  modules: Pick<TeacherCourseModule, "lessons">[],
  assets: Pick<CourseAsset, "kind" | "lessonId">[],
): number {
  const lessonIds = new Set(modules.flatMap((courseModule) => courseModule.lessons.map((lesson) => lesson.id)));
  return assets.filter(
    (asset) => asset.kind === "lesson_material" && asset.lessonId !== null && lessonIds.has(asset.lessonId),
  ).length;
}

// Sessions of this product that are still standing and yet to come: one that has passed cannot be sold
// (publish_teacher_course requires the same). The builder and Manage read from here.
export function upcomingSessionsOf<T extends { courseId: string; status: string; startsAt: string }>(
  events: T[],
  courseId: string,
  now: number,
): T[] {
  return events.filter(
    (event) => event.courseId === courseId && event.status === "scheduled" && Date.parse(event.startsAt) > now,
  );
}

// Locks that are not about the course, they are about the teacher. Only Manage knew them; the
// builder let the person click Publish and find out through the server's
// error. Optional for whoever does not have the profile loaded (e.g. pure tests).
export type CourseReadinessAccount = {
  payoutsReady: boolean;
  verificationRequired: boolean;
  verificationApproved: boolean;
  // The one-time fee only showed up as a database error after the click on Publish.
  // It comes from the same predicate as the trigger (creator_activation_blocked).
  activationBlocked?: boolean;
  planRequired?: boolean;
};

export type CourseReadinessItemId =
  | "title"
  | "summary"
  | "category"
  | "cover"
  | "module"
  | "lesson"
  | "lessonMedia"
  | "community"
  | "session"
  | "file"
  | "pricing"
  | "installments"
  | "outcomes"
  | "payouts"
  | "verification"
  | "activation"
  | "plan";

// The three states that Hotmart separates and the "N of M" bar mixed up:
// saved content (what the learner watches), prepared page (what the buyer
// reads) and sale available (what the money requires). Only grouping and label;
// nothing here holds back publishing.
export type CourseReadinessGroupId = "content" | "page" | "sale";

export type CourseReadinessItem = {
  id: CourseReadinessItemId;
  group: CourseReadinessGroupId;
  label: string;
  // Presentation can be localized; callers without a translator keep English.
  hint: string;
  done: boolean;
  // Optional does not enter the percentage nor block publish.
  optional: boolean;
};

export type CourseReadiness = {
  items: CourseReadinessItem[];
  // Required items still open, in the order in which the person should resolve them.
  pending: CourseReadinessItem[];
  next: CourseReadinessItem | null;
  doneCount: number;
  total: number;
  percent: number;
  ready: boolean;
};

export function getCourseReadiness(
  course: CourseReadinessInput,
  account?: CourseReadinessAccount,
  t?: (key: string) => string,
): CourseReadiness {
  // An old course may not have paymentType stored; the builder has always read
  // price 0 as Free and everything else as a one-time sale. Same reading here.
  const paymentType =
    course.paymentType ?? (course.priceAmountMinor === 0 ? "free" : "one_time");
  const priceAmountMinor = course.priceAmountMinor ?? 0;
  const modules = course.modules ?? [];
  // What each type needs to deliver. Course: module and lesson. Community: the
  // community turned on (lessons optional). Live event: the session. E-book: one
  // file.
  const productFormat = course.productFormat ?? "course";
  const paid = paymentType !== "free" && priceAmountMinor > 0;
  // A product created before the rule may charge in a way the type does not
  // accept (community by one-time payment). Publishing rejects it (trigger of
  // 20261007030000); here the person sees it beforehand, in the price item.
  const paymentFits = paymentTypeFitsFormat(course.productFormat ?? "course", paymentType);
  // A hard-coded "$0" said dollars to whoever sells in reais: the zero comes in the chosen currency.
  const zeroPrice = formatZeroPrice(course.currency);
  const lessons = modules.flatMap((courseModule) => courseModule.lessons);
  const withMedia = course.lessonIdsWithMedia;
  const lessonsWithoutMedia = withMedia ? lessons.filter((lesson) => !withMedia.has(lesson.id)) : [];
  // The first three empty lessons, by the title the teacher gave, and how many
  // more are missing ("and N more", like the panel notice; no "…" before the period).
  const missingLessonsText = (untitled: string, one: string, more: string) => {
    const names = lessonsWithoutMedia.slice(0, 3).map((lesson) => lesson.title.trim() || untitled).join(", ");
    const extra = lessonsWithoutMedia.length - 3;
    return (extra > 0 ? more : one)
      .replace("{count}", () => String(extra))
      .replace("{lessons}", () => names);
  };

  const items: CourseReadinessItem[] = [
    {
      id: "title",
      group: "content",
      label: "Course title",
      // 3 characters is the minimum of the creation form and of Manage; the
      // builder accepted any character. The strictest one applies.
      hint: "Give the course a title (3+ characters).",
      done: course.title.trim().length >= 3,
      optional: false,
    },
    {
      id: "summary",
      group: "page",
      // "Description" on every screen: creation, builder and checklist. The key
      // is still `summary`.
      label: "Description",
      hint: "Write a description with at least 20 characters.",
      done: course.summary.trim().length >= 20,
      optional: false,
    },
    {
      id: "category",
      group: "page",
      label: "Marketplace category",
      hint: "Choose at least one marketplace category.",
      done:
        normalizeCourseCategories([...(course.categories ?? []), course.category])
          .length > 0,
      optional: false,
    },
    {
      id: "cover",
      group: "page",
      label: "Cover image",
      hint: "Upload a cover — it fronts the product page and marketplace cards.",
      done: Boolean(course.coverImageUrl),
      optional: true,
    },
    ...(productFormat === "course"
      ? [
          {
            id: "module" as const,
            group: "content" as const,
            label: "Module",
            hint: "Add at least one module.",
            done: modules.length > 0,
            optional: false,
          },
          {
            id: "lesson" as const,
            group: "content" as const,
            label: "Lesson",
            hint: "Add at least one lesson.",
            done: countCourseLessons(modules) > 0,
            optional: false,
          },
        ]
      : []),
    ...(productFormat === "community"
      ? [{
          id: "community" as const,
          group: "content" as const,
          label: "Community turned on",
          hint: "Turn the community on in the Members Area tab: it is what members join.",
          done: course.communityEnabled === true,
          optional: false,
        }]
      : []),
    ...(productFormat === "live_event" && course.scheduledSessionCount !== undefined
      ? [{
          id: "session" as const,
          group: "content" as const,
          label: "Live session",
          hint: "Schedule the date and time of the live session.",
          done: course.scheduledSessionCount > 0,
          optional: false,
        }]
      : []),
    ...(productFormat === "ebook" && course.lessonFileCount !== undefined
      ? [{
          id: "file" as const,
          group: "content" as const,
          label: "File to download",
          hint: "Upload at least one file: PDF, slides or workbook.",
          done: course.lessonFileCount > 0,
          optional: false,
        }]
      : []),
    // Only with the list of lessons with content and at least one lesson: with no lesson, the
    // "lesson" item already covers it, and listing this one would give a free "done". In the
    // e-book the lesson does not show on the screen; the "file" item requires the same file.
    ...(withMedia && lessons.length > 0 && productFormat !== "ebook"
      ? [{
          id: "lessonMedia" as const,
          group: "content" as const,
          label: "Lesson content",
          hint: lessonsWithoutMedia.length
            ? `Add a video, text or file to every lesson. ${missingLessonsText(
                "Untitled lesson",
                "Missing: {lessons}.",
                "Missing: {lessons} and {count} more.",
              )}`
            : "Add a video, text or file to every lesson.",
          done: lessonsWithoutMedia.length === 0,
          optional: false,
        }]
      : []),
    // A free product has no price to set: listing "Pricing" as done only
    // made whoever chose Free read "Set a paid price" in the checklist.
    ...(paymentType === "free"
      ? []
      : [{
          id: "pricing" as const,
          group: "sale" as const,
          label: "Pricing",
          hint: paymentFits
            ? `Set a price above ${zeroPrice}, or choose Free.`
            : "This way of paying does not fit this type of product. Pick another one in Pricing.",
          done: priceAmountMinor > 0 && paymentFits,
          optional: false,
        }]),
    {
      id: "outcomes",
      group: "page",
      label: "Learning outcomes",
      hint: "Add learning outcomes — they lift conversion on the product page.",
      done: (course.learningOutcomes?.length ?? 0) > 0,
      optional: true,
    },
  ];

  // Installments only exist on a one-time sale with the option turned on. Listing the item
  // always (as the builder did) gave a free "done" and inflated the
  // percentage of an empty course.
  if (paymentType === "one_time" && course.installmentsEnabled) {
    items.push({
      id: "installments",
      group: "sale",
      label: "Installments",
      hint: "Set a valid installment limit.",
      done:
        typeof course.installmentsMax === "number" && course.installmentsMax >= 1,
      optional: false,
    });
  }

  if (account) {
    if (account.planRequired) {
      items.push({
        id: "plan",
        group: "sale",
        label: "Creator plan",
        hint: "Start your 14-day free trial or renew your plan to publish and sell.",
        done: false,
        optional: false,
      });
    }
    if (paid) {
      items.push({
        id: "payouts",
        group: "sale",
        label: "Stripe payouts",
        hint: "Finish Stripe payout onboarding before publishing a paid course.",
        done: account.payoutsReady,
        optional: false,
      });
    }
    items.push({
      id: "verification",
      group: "sale",
      label: "Professional verification",
      hint: account.verificationRequired
        ? "Complete professional verification before publishing."
        : "Optional today — becomes required when professional admission opens.",
      done: account.verificationApproved,
      optional: !account.verificationRequired,
    });
    if (account.activationBlocked) {
      items.push({
        id: "activation",
        group: "sale",
        label: `Activation — US$${activationFeeUsd}, one time`,
        hint: "Charged once per creator account, never per course. Paying unlocks publishing.",
        done: false,
        optional: false,
      });
    }
  }

  if (t) {
    for (const item of items) {
      item.label = t(`creatorEditor.readiness.items.${item.id}.label`);
      item.hint = t(`creatorEditor.readiness.items.${item.id}.${
        item.id === "verification" && item.optional ? "optionalHint" : "hint"
      }`);
      if (item.id === "activation") {
        item.label = item.label.replace("{amount}", () => String(activationFeeUsd));
      }
      if (item.id === "pricing") {
        item.hint = paymentFits
          ? item.hint.replace("{zero}", () => zeroPrice)
          : t("creatorEditor.readiness.items.pricing.notForType");
      }
      if (item.id === "lessonMedia" && !item.done) {
        item.hint += ` ${missingLessonsText(
          t("creatorEditor.lesson.untitled"),
          t("creatorEditor.readiness.items.lessonMedia.missing"),
          t("creatorEditor.readiness.items.lessonMedia.missingMore"),
        )}`;
      }
    }
  }

  const required = items.filter((item) => !item.optional);
  const pending = required.filter((item) => !item.done);
  const doneCount = required.length - pending.length;

  return {
    items,
    pending,
    next: pending[0] ?? null,
    doneCount,
    total: required.length,
    percent: required.length
      ? Math.round((doneCount / required.length) * 100)
      : 0,
    ready: pending.length === 0,
  };
}

export function formatZeroPrice(currency: string | null | undefined): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(0);
  } catch {
    return `0 ${String(currency || "USD").toUpperCase()}`;
  }
}

export type CourseReadinessGroup = {
  id: CourseReadinessGroupId;
  items: CourseReadinessItem[];
  // Same count as `doneCount`/`total`: required items only. Optional ones appear
  // in the group's list and stay out of the number, as they already did in the overall one.
  doneCount: number;
  total: number;
  ready: boolean;
};

export const COURSE_READINESS_GROUP_IDS: readonly CourseReadinessGroupId[] = [
  "content",
  "page",
  "sale",
];

// Pure cut over the list already computed: it does not change `ready`, `percent` nor the
// ids. A group with nothing required (e.g. sale of a free course with no account) counts
// as ready, and the sum of the three `doneCount`/`total` matches the overall one.
export function groupCourseReadiness(
  readiness: Pick<CourseReadiness, "items">,
): CourseReadinessGroup[] {
  return COURSE_READINESS_GROUP_IDS.map((id) => {
    const items = readiness.items.filter((item) => item.group === id);
    const required = items.filter((item) => !item.optional);
    const doneCount = required.filter((item) => item.done).length;
    return { id, items, doneCount, total: required.length, ready: doneCount === required.length };
  });
}
