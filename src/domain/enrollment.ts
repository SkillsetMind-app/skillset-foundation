import type { Course, CourseStatus } from "@/domain/learning";

export type EnrollmentStatus =
  | "active"
  | "completed"
  | "refunded"
  | "revoked"
  | "expired";

export type EnrollmentSource =
  | "manual_demo"
  | "free_course"
  | "payment"
  | "subscription"
  | "creator"
  | "admin";

export type Enrollment = {
  id: string;
  userId: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  courseCategory: string;
  courseImage: string;
  status: EnrollmentStatus;
  source: EnrollmentSource;
  // Set only for source === "subscription": the Stripe subscription backing the
  // access, used by the learner cancel UI + cancelCourseSubscription function.
  subscriptionId?: string | null;
  progressPercent: number;
  lastLessonId: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type EnrollmentCommunityCard = {
  id: string;
  categories: string;
  courseTitle: string;
  description: string;
  href: string;
  name: string;
  visibility: string;
};

export function getEnrollmentId(userId: string, courseSlug: string): string {
  return `${userId}__${courseSlug}`;
}

export function canSelfEnrollCourse(status: CourseStatus): boolean {
  return status === "published" || status === "pilot";
}

export function canOpenEnrollment(status: EnrollmentStatus): boolean {
  return status === "active" || status === "completed";
}

export function canContinueEnrollment(status: EnrollmentStatus): boolean {
  return status === "active";
}

export function createEnrollmentSnapshot(course: Course) {
  return {
    courseId: course.id,
    courseSlug: course.slug,
    courseTitle: course.title,
    courseCategory: course.category,
    courseImage: course.image,
  };
}

/** Courses whose community the "Communities" list may show: open
 *  enrollment (it is what the classroom accepts) and community turned on. */
export function communityEnrollmentCourseIds(enrollments: Enrollment[]): string[] {
  return [
    ...new Set(
      enrollments
        .filter((enrollment) => canOpenEnrollment(enrollment.status) && enrollment.source !== "manual_demo")
        .map((enrollment) => enrollment.courseId),
    ),
  ].sort();
}

export function createEnrollmentCommunityCards(
  enrollments: Enrollment[],
  communityCourseIds: ReadonlySet<string>,
): EnrollmentCommunityCard[] {
  return enrollments
    .filter((enrollment) => canOpenEnrollment(enrollment.status))
    // Community turned off: the classroom does not even show the tab, so the card does not
    // appear. ponytail: the demo catalog (manual_demo) does not live in the
    // courses table and is always born with a community (src/data/demo/courses.ts).
    .filter(
      (enrollment) =>
        enrollment.source === "manual_demo" || communityCourseIds.has(enrollment.courseId),
    )
    .map((enrollment) => ({
      id: `community-${enrollment.id}`,
      categories: "course community",
      courseTitle: enrollment.courseTitle,
      description:
        "A course-linked space for teacher announcements, learner questions, discussion, and shared resources.",
      // The community is a TAB of the classroom, with its own address
      // (/learn/courses/<course>/community). Before there were two faces for the
      // same feed: inside the lesson, in the course theme, and in a separate hub with a
      // big headline, and neither went back to the lesson. Demo/catalog
      // (manual_demo) uses the slug; a course published by a teacher uses the id (the
      // classroom route accepts both).
      href: `/learn/courses/${
        enrollment.source === "manual_demo"
          ? enrollment.courseSlug
          : enrollment.courseId
      }/community`,
      name: `${enrollment.courseTitle} community`,
      visibility: "enrolled only",
    }));
}
