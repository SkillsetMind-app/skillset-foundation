import { describe, expect, it } from "vitest";

import type { CourseAsset } from "@/domain/course-asset";
import type { CourseCoupon } from "@/domain/course-commerce";
import {
  getCourseMaintenanceIssues,
  getCourseOverviewStats,
  type CourseOverviewOrder,
  type CourseOverviewStudent,
} from "@/domain/course-overview";
import type { TeacherCourse } from "@/domain/teacher-course";

const NOW = new Date("2026-09-03T12:00:00.000Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

const course = {
  id: "course-1",
  ownerId: "teacher-1",
  title: "Hypnosis Basics",
  summary: "A summary long enough to pass the readiness rule.",
  category: "Personal Development",
  status: "published",
  modules: [],
  lessonCount: 0,
  priceAmountMinor: 9900,
  paymentType: "one_time",
  currency: "usd",
  coverImageUrl: "https://example.com/cover.jpg",
  learningOutcomes: ["Outcome"],
  ratingAverage: 4.5,
  ratingCount: 4,
} as TeacherCourse;

function student(overrides: Partial<CourseOverviewStudent> = {}): CourseOverviewStudent {
  return {
    courseId: "course-1",
    status: "active",
    progressPercent: 40,
    enrolledAt: daysAgo(30),
    ...overrides,
  };
}

function order(overrides: Partial<CourseOverviewOrder> = {}): CourseOverviewOrder {
  return {
    courseId: "course-1",
    status: "paid",
    currency: "usd",
    amountMinor: 9900,
    ...overrides,
  };
}

describe("getCourseOverviewStats", () => {
  it("counts only this product — both reads bring the whole store", () => {
    const stats = getCourseOverviewStats({
      course,
      students: [student(), student({ courseId: "course-2" })],
      orders: [order(), order({ courseId: "course-2", amountMinor: 50000 })],
      now: NOW,
    });

    expect(stats.studentCount).toBe(1);
    expect(stats.paidOrderCount).toBe(1);
    expect(stats.revenue).toEqual([{ currency: "USD", netMinor: 9900 }]);
  });

  it("subtracts what went back to the buyer instead of counting gross", () => {
    const stats = getCourseOverviewStats({
      course,
      students: [],
      orders: [order({ refundedAmountMinor: 4900 })],
      now: NOW,
    });

    expect(stats.revenue).toEqual([{ currency: "USD", netMinor: 5000 }]);
  });

  it("never adds two currencies into one number", () => {
    const stats = getCourseOverviewStats({
      course,
      students: [],
      orders: [order(), order({ currency: "brl", amountMinor: 49900 })],
      now: NOW,
    });

    expect(stats.revenue).toEqual([
      { currency: "BRL", netMinor: 49900 },
      { currency: "USD", netMinor: 9900 },
    ]);
  });

  it("ignores orders that were never paid", () => {
    const stats = getCourseOverviewStats({
      course,
      students: [],
      orders: [order({ status: "pending" }), order({ status: "refunded" })],
      now: NOW,
    });

    expect(stats.paidOrderCount).toBe(0);
    expect(stats.revenue).toEqual([]);
    expect(stats.hasHistory).toBe(false);
  });

  it("reads 100% progress and a completed enrollment as the same finish line", () => {
    const stats = getCourseOverviewStats({
      course,
      students: [
        student({ progressPercent: 100 }),
        student({ status: "completed", progressPercent: 80 }),
        student({ progressPercent: 10 }),
        student({ progressPercent: 0 }),
      ],
      orders: [],
      now: NOW,
    });

    expect(stats.completedCount).toBe(2);
    expect(stats.completionPercent).toBe(50);
    expect(stats.averageProgressPercent).toBe(48);
  });

  it("leaves completion and rating unmeasured rather than reporting a zero", () => {
    const stats = getCourseOverviewStats({
      course: { ...course, ratingAverage: undefined, ratingCount: 0 },
      students: [],
      orders: [],
      now: NOW,
    });

    expect(stats.completionPercent).toBeNull();
    expect(stats.averageProgressPercent).toBeNull();
    expect(stats.ratingAverage).toBeNull();
    expect(stats.hasHistory).toBe(false);
  });

  it("counts the last seven days as new, and the eighth as not", () => {
    const stats = getCourseOverviewStats({
      course,
      students: [
        student({ enrolledAt: daysAgo(1) }),
        student({ enrolledAt: daysAgo(6) }),
        student({ enrolledAt: daysAgo(8) }),
      ],
      orders: [],
      now: NOW,
    });

    expect(stats.newThisWeekCount).toBe(2);
  });
});

const withLessons = {
  ...course,
  modules: [
    {
      id: "m1",
      title: "Module 1",
      lessons: [
        { id: "l1", title: "Empty lesson", type: "video", description: "" },
        { id: "l2", title: "Has a video", type: "video", description: "" },
        {
          id: "l3",
          title: "Has an embed",
          type: "video",
          description: "",
          externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
        { id: "l4", title: "Has text", type: "text", description: "", contentText: "Body" },
      ],
    },
  ],
} as TeacherCourse;

const videoAsset = {
  id: "asset-1",
  courseId: "course-1",
  ownerId: "teacher-1",
  kind: "lesson_video",
  fileName: "lesson.mp4",
  contentType: "video/mp4",
  size: 10,
  storagePath: "path",
  isPreview: false,
  lessonId: "l2",
} as CourseAsset;

function coupon(overrides: Partial<CourseCoupon> = {}): CourseCoupon {
  return {
    id: "coupon-1",
    courseId: "course-1",
    ownerId: "teacher-1",
    code: "LAUNCH",
    percentOff: 20,
    maxRedemptions: null,
    redeemedCount: 0,
    active: true,
    createdAt: daysAgo(60),
    updatedAt: daysAgo(60),
    ...overrides,
  };
}

describe("getCourseMaintenanceIssues", () => {
  it("names the lesson that opens empty for the buyer, and spares the three that do not", () => {
    const issues = getCourseMaintenanceIssues({
      course: withLessons,
      assets: [videoAsset],
      coupons: [],
      now: NOW,
    });

    const empty = issues.find((issue) => issue.id === "empty-lessons");
    expect(empty?.title).toBe("1 lesson has no content");
    expect(empty?.hint).toContain("Empty lesson");
    expect(empty?.hint).not.toContain("Has a video");
  });

  it("stays quiet about lesson content while the assets read has not answered", () => {
    const issues = getCourseMaintenanceIssues({
      course: withLessons,
      assets: null,
      coupons: [],
      now: NOW,
    });

    expect(issues.some((issue) => issue.id === "empty-lessons")).toBe(false);
  });

  it("flags a coupon that still reads active after its end date passed", () => {
    const issues = getCourseMaintenanceIssues({
      course,
      assets: [],
      coupons: [
        coupon({ expiresAt: daysAgo(2) }),
        coupon({ id: "coupon-2", code: "STILLGOOD", expiresAt: daysAgo(-30) }),
        coupon({ id: "coupon-3", code: "OFF", active: false, expiresAt: daysAgo(2) }),
      ],
      now: NOW,
    });

    const expired = issues.find((issue) => issue.id === "expired-coupons");
    expect(expired?.title).toBe("1 active coupon is past its end date");
    expect(expired?.hint).toContain("LAUNCH");
    expect(expired?.hint).not.toContain("STILLGOOD");
  });

  it("picks up the optional publish steps a live product forgets", () => {
    const issues = getCourseMaintenanceIssues({
      course: { ...course, coverImageUrl: null, learningOutcomes: [] },
      assets: [],
      coupons: [],
      now: NOW,
    });

    expect(issues.map((issue) => issue.id)).toEqual([
      "readiness-cover",
      "readiness-outcomes",
    ]);
  });

  it("keeps account-wide chores out of a single product's list", () => {
    const issues = getCourseMaintenanceIssues({
      course,
      account: {
        payoutsReady: false,
        verificationRequired: false,
        verificationApproved: false,
      },
      assets: [],
      coupons: [],
      now: NOW,
    });

    expect(issues.some((issue) => issue.id === "readiness-verification")).toBe(false);
    expect(issues).toEqual([]);
  });
});
