import { describe, expect, it } from "vitest";

import { getCredentialCandidate } from "@/domain/certificate";
import type { Certificate } from "@/domain/certificate";
import type { Enrollment } from "@/domain/enrollment";

const enrollment: Enrollment = {
  id: "user__course",
  userId: "user",
  courseId: "course",
  courseSlug: "course",
  courseTitle: "Course",
  courseCategory: "Management",
  courseImage: "/course.jpg",
  status: "active",
  source: "manual_demo",
  progressPercent: 40,
  lastLessonId: null,
};

describe("credential candidates", () => {
  it("keeps incomplete enrollments in progress", () => {
    expect(getCredentialCandidate(enrollment).status).toBe("in_progress");
  });

  it("marks completed enrollments as eligible for SkillsetMind review", () => {
    expect(
      getCredentialCandidate({
        ...enrollment,
        status: "completed",
        progressPercent: 100,
      }).status,
    ).toBe("eligible");
  });

  it("uses issued certificate records when they exist", () => {
    const certificate: Certificate = {
      id: enrollment.id,
      enrollmentId: enrollment.id,
      userId: enrollment.userId,
      courseId: enrollment.courseId,
      courseSlug: enrollment.courseSlug,
      courseTitle: enrollment.courseTitle,
      courseCategory: enrollment.courseCategory,
      authorityLabel: "SkillsetMind Verified",
      status: "issued",
      verificationCode: "SK-COURSE-123",
    };

    const candidate = getCredentialCandidate(
      {
        ...enrollment,
        status: "completed",
        progressPercent: 100,
      },
      certificate,
    );

    expect(candidate.status).toBe("issued");
    expect(candidate.verificationCode).toBe("SK-COURSE-123");
  });
});
