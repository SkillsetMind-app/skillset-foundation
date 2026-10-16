import { describe, expect, it } from "vitest";

import {
  canContinueEnrollment,
  communityEnrollmentCourseIds,
  createEnrollmentCommunityCards,
  canOpenEnrollment,
  canSelfEnrollCourse,
  createEnrollmentSnapshot,
  getEnrollmentId,
} from "@/domain/enrollment";

describe("enrollment helpers", () => {
  it("builds a stable enrollment id", () => {
    expect(getEnrollmentId("user-1", "effective-communication")).toBe(
      "user-1__effective-communication",
    );
  });

  it("allows self-enrollment only for open learning access states", () => {
    expect(canSelfEnrollCourse("published")).toBe(true);
    expect(canSelfEnrollCourse("pilot")).toBe(true);
    expect(canSelfEnrollCourse("draft")).toBe(false);
    expect(canSelfEnrollCourse("waitlist")).toBe(false);
  });

  it("opens private course content only for usable enrollment states", () => {
    expect(canOpenEnrollment("active")).toBe(true);
    expect(canOpenEnrollment("completed")).toBe(true);
    expect(canOpenEnrollment("refunded")).toBe(false);
    expect(canOpenEnrollment("revoked")).toBe(false);
    expect(canOpenEnrollment("expired")).toBe(false);
  });

  it("continues only active enrollments, never completed courses", () => {
    expect(canContinueEnrollment("active")).toBe(true);
    expect(canContinueEnrollment("completed")).toBe(false);
    expect(canContinueEnrollment("refunded")).toBe(false);
    expect(canContinueEnrollment("revoked")).toBe(false);
    expect(canContinueEnrollment("expired")).toBe(false);
  });

  it("creates a course snapshot for enrollment records", () => {
    const snapshot = createEnrollmentSnapshot({
      id: "course-1",
      slug: "leadership-development",
      title: "Leadership Development",
      category: "Management",
      durationLabel: "8-12 weeks",
      status: "pilot",
      statusLabel: "Pilot cohort",
      summary: "Summary",
      detail: "Detail",
      image: "https://example.com/course.jpg",
      level: "Professional",
      priceLabel: "$149 pilot access",
      priceAmountMinor: 14900,
      currency: "USD",
      platformFeeBps: 800,
      freePreviewLabel: "Free preview",
      outcomes: [],
      modules: [],
      communityEnabled: true,
    });

    expect(snapshot).toEqual({
      courseId: "course-1",
      courseSlug: "leadership-development",
      courseTitle: "Leadership Development",
      courseCategory: "Management",
      courseImage: "https://example.com/course.jpg",
    });
  });

  it("creates course community cards only from open real enrollments with the community on", () => {
    const enrollments: Parameters<typeof createEnrollmentCommunityCards>[0] = [
      {
        id: "enrollment-active",
        userId: "user-1",
        courseId: "course-1",
        courseSlug: "leadership-development",
        courseTitle: "Leadership Development",
        courseCategory: "Management",
        courseImage: "https://example.com/course.jpg",
        status: "active",
        source: "payment",
        progressPercent: 40,
        lastLessonId: "lesson-1",
      },
      {
        id: "enrollment-refunded",
        userId: "user-1",
        courseId: "course-2",
        courseSlug: "refunded-course",
        courseTitle: "Refunded Course",
        courseCategory: "Marketing",
        courseImage: "https://example.com/refunded.jpg",
        status: "refunded",
        source: "payment",
        progressPercent: 0,
        lastLessonId: null,
      },
      {
        id: "enrollment-demo",
        userId: "user-1",
        courseId: "course-applied-behavior",
        courseSlug: "applied-behavior-coaching",
        courseTitle: "Applied Behavior Coaching",
        courseCategory: "Applied Psychology & Behavior",
        courseImage: "https://example.com/applied.jpg",
        status: "active",
        source: "manual_demo",
        progressPercent: 10,
        lastLessonId: null,
      },
      {
        id: "enrollment-community-off",
        userId: "user-1",
        courseId: "course-3",
        courseSlug: "quiet-course",
        courseTitle: "Quiet Course",
        courseCategory: "Management",
        courseImage: "https://example.com/quiet.jpg",
        status: "active",
        source: "payment",
        progressPercent: 0,
        lastLessonId: null,
      },
    ];

    // So os cursos reais com matricula aberta vao ao banco perguntar.
    expect(communityEnrollmentCourseIds(enrollments)).toEqual(["course-1", "course-3"]);

    // course-3 esta com a comunidade desligada: nao entra no conjunto.
    const cards = createEnrollmentCommunityCards(enrollments, new Set(["course-1"]));

    expect(cards).toEqual([
      {
        id: "community-enrollment-active",
        categories: "course community",
        courseTitle: "Leadership Development",
        description:
          "A course-linked space for teacher announcements, learner questions, discussion, and shared resources.",
        href: "/learn/courses/course-1/community",
        name: "Leadership Development community",
        visibility: "enrolled only",
      },
      {
        id: "community-enrollment-demo",
        categories: "course community",
        courseTitle: "Applied Behavior Coaching",
        description:
          "A course-linked space for teacher announcements, learner questions, discussion, and shared resources.",
        href: "/learn/courses/applied-behavior-coaching/community",
        name: "Applied Behavior Coaching community",
        visibility: "enrolled only",
      },
    ]);
  });
});
