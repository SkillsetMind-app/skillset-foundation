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

export function createEnrollmentCommunityCards(
  enrollments: Enrollment[],
): EnrollmentCommunityCard[] {
  return enrollments
    .filter((enrollment) => canOpenEnrollment(enrollment.status))
    .map((enrollment) => ({
      id: `community-${enrollment.id}`,
      categories: "course community",
      courseTitle: enrollment.courseTitle,
      description:
        "A course-linked space for teacher announcements, learner questions, discussion, and shared resources.",
      // A comunidade e uma ABA da sala de aula, com endereco proprio
      // (/learn/courses/<curso>/community). Antes havia duas caras para o
      // mesmo feed: dentro da aula, no tema do curso, e num hub separado com
      // manchete grande — e nenhuma voltava para a aula. Demo/catalogo
      // (manual_demo) usa o slug; curso publicado por professor usa o id (a
      // rota da sala aceita os dois).
      href: `/learn/courses/${
        enrollment.source === "manual_demo"
          ? enrollment.courseSlug
          : enrollment.courseId
      }/community`,
      name: `${enrollment.courseTitle} community`,
      visibility: "enrolled only",
    }));
}
