import { describe, expect, it } from "vitest";

import {
  countCourseLessons,
  inferLessonVideoSource,
  normalizeCourseCategories,
  normalizeInstallmentsMax,
  resolveTeacherCoursePaymentType,
  adminCanRepublishCourse,
  adminCanUnpublishCourse,
  normalizeMembersText,
  normalizeMembersTheme,
  MAX_MEMBERS_TITLE_LENGTH,
  normalizeTeacherCourseModules,
  isCoursePubliclySellable,
  teacherCanDeleteCourse,
  teacherCanEditCourse,
  teacherCanPublishCourse,
  type TeacherCourseModule,
} from "./teacher-course";

describe("teacher course domain", () => {
  it("maps product format and billing interval to the stored payment type", () => {
    expect(resolveTeacherCoursePaymentType("course", "monthly")).toBe("one_time");
    expect(resolveTeacherCoursePaymentType("free", "yearly")).toBe("free");
    expect(resolveTeacherCoursePaymentType("subscription", "monthly")).toBe(
      "subscription_monthly",
    );
    expect(resolveTeacherCoursePaymentType("subscription", "yearly")).toBe(
      "subscription_yearly",
    );
  });

  it("counts lessons across modules", () => {
    const modules: TeacherCourseModule[] = [
      {
        id: "module-1",
        title: "Foundation",
        lessons: [
          { id: "lesson-1", title: "Welcome", type: "video", description: "" },
          { id: "lesson-2", title: "Core idea", type: "text", description: "" },
        ],
      },
      {
        id: "module-2",
        title: "Practice",
        lessons: [
          { id: "lesson-3", title: "Reflection", type: "assignment", description: "" },
        ],
      },
    ];

    expect(countCourseLessons(modules)).toBe(3);
  });

  it("models direct publication and legacy review states", () => {
    expect(teacherCanEditCourse("draft")).toBe(true);
    expect(teacherCanEditCourse("needs_changes")).toBe(true);
    expect(teacherCanEditCourse("published")).toBe(true);
    expect(teacherCanEditCourse("in_review")).toBe(false);

    expect(teacherCanPublishCourse("draft")).toBe(true);
    expect(teacherCanPublishCourse("in_review")).toBe(true);
    expect(teacherCanPublishCourse("needs_changes")).toBe(true);
    expect(teacherCanPublishCourse("inactive")).toBe(true);
    expect(teacherCanPublishCourse("published")).toBe(false);

    expect(teacherCanDeleteCourse("draft")).toBe(true);
    expect(teacherCanDeleteCourse("needs_changes")).toBe(true);
    expect(teacherCanDeleteCourse("in_review")).toBe(false);
    expect(teacherCanDeleteCourse("published")).toBe(false);
    expect(teacherCanDeleteCourse("inactive")).toBe(false);
  });

  it("gates admin marketplace controls by status", () => {
    expect(adminCanUnpublishCourse("published")).toBe(true);
    expect(adminCanUnpublishCourse("inactive")).toBe(false);
    expect(adminCanUnpublishCourse("draft")).toBe(false);

    expect(adminCanRepublishCourse("inactive")).toBe(true);
    expect(adminCanRepublishCourse("published")).toBe(false);
    expect(adminCanRepublishCourse("in_review")).toBe(false);
  });

  it("sells only courses approved for publication", () => {
    expect(isCoursePubliclySellable("published")).toBe(true);
    expect(isCoursePubliclySellable("in_review")).toBe(false);
    expect(isCoursePubliclySellable("draft")).toBe(false);
    expect(isCoursePubliclySellable("needs_changes")).toBe(false);
    expect(isCoursePubliclySellable("inactive")).toBe(false);
  });

  it("normalizes installment limits for one-time courses", () => {
    expect(normalizeInstallmentsMax(12)).toBe(12);
    expect(normalizeInstallmentsMax(40)).toBe(36);
    expect(normalizeInstallmentsMax(0)).toBe(1);
    expect(normalizeInstallmentsMax(null)).toBeNull();
  });

  it("deduplicates selected course categories", () => {
    expect(
      normalizeCourseCategories([
        "Mental Health Foundations",
        " mental health foundations ",
        "Supervision & Continuing Education",
        "",
      ]),
    ).toEqual([
      "Mental Health Foundations",
      "Supervision & Continuing Education",
    ]);
  });

  it("accepts only light/dark for the members-area theme", () => {
    expect(normalizeMembersTheme("light")).toBe("light");
    expect(normalizeMembersTheme("dark")).toBe("dark");
    expect(normalizeMembersTheme("Dark")).toBeNull();
    expect(normalizeMembersTheme("")).toBeNull();
    expect(normalizeMembersTheme(null)).toBeNull();
    expect(normalizeMembersTheme(undefined)).toBeNull();
    expect(normalizeMembersTheme(42)).toBeNull();
  });

  it("trims and caps members-area text fields", () => {
    expect(normalizeMembersText("  Hero title  ", MAX_MEMBERS_TITLE_LENGTH)).toBe(
      "Hero title",
    );
    expect(normalizeMembersText("   ", MAX_MEMBERS_TITLE_LENGTH)).toBeNull();
    expect(normalizeMembersText(null, MAX_MEMBERS_TITLE_LENGTH)).toBeNull();
    expect(normalizeMembersText(123, MAX_MEMBERS_TITLE_LENGTH)).toBeNull();
    expect(
      normalizeMembersText("a".repeat(120), MAX_MEMBERS_TITLE_LENGTH),
    ).toHaveLength(MAX_MEMBERS_TITLE_LENGTH);
  });

  it("normalizes modules, lessons, module copy, and lesson media references", () => {
    expect(
      normalizeTeacherCourseModules([
        {
          id: "module-1",
          title: " Foundations ",
          summary: "  Start here  ",
          coverAssetId: undefined,
          lessons: [
            {
              id: "lesson-1",
              title: " Intro ",
              type: "video",
              description: "  Watch first  ",
              durationMinutes: undefined,
              contentText: "  Notes  ",
              externalUrl: "  https://youtu.be/dQw4w9WgXcQ  ",
              videoSource: "youtube",
              dripDelayDays: 2.6,
              thumbnailAssetId: undefined,
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "module-1",
        title: "Foundations",
        summary: "Start here",
        coverAssetId: null,
        lessons: [
          {
            id: "lesson-1",
            title: "Intro",
            type: "video",
            description: "Watch first",
            durationMinutes: null,
            contentText: "Notes",
            externalUrl: "https://youtu.be/dQw4w9WgXcQ",
            videoSource: "youtube",
            dripDelayDays: 3,
            thumbnailAssetId: null,
          },
        ],
      },
    ]);
  });

  it("preserves upload sources and normalizes absent or invalid sources to null", () => {
    const modules = [
      {
        id: "module-1",
        title: "Video sources",
        lessons: [
          {
            id: "lesson-upload",
            title: "Upload",
            type: "video",
            description: "",
            videoSource: "upload",
          },
          {
            id: "lesson-legacy",
            title: "Legacy",
            type: "video",
            description: "",
          },
          {
            id: "lesson-invalid",
            title: "Invalid",
            type: "video",
            description: "",
            videoSource: "vimeo",
          },
        ],
      },
    ] as unknown as TeacherCourseModule[];

    const [upload, legacy, invalid] = normalizeTeacherCourseModules(modules)[0].lessons;

    expect(upload.videoSource).toBe("upload");
    expect(legacy.videoSource).toBeNull();
    expect(invalid.videoSource).toBeNull();
  });

  it("infers upload when both a video asset and trusted embed exist", () => {
    expect(
      inferLessonVideoSource({ hasVideoAsset: true, hasTrustedEmbed: true }),
    ).toBe("upload");
  });

  it("infers youtube when only a trusted embed exists", () => {
    expect(
      inferLessonVideoSource({ hasVideoAsset: false, hasTrustedEmbed: true }),
    ).toBe("youtube");
  });

  it("infers no source when neither video option exists", () => {
    expect(
      inferLessonVideoSource({ hasVideoAsset: false, hasTrustedEmbed: false }),
    ).toBeNull();
  });
});
