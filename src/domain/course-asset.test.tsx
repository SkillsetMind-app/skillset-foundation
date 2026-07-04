import { describe, expect, it } from "vitest";

import {
  canViewCourseAssetVideo,
  courseAssetAcceptTypes,
  courseAssetKindLabels,
  isAllowedCourseAssetFile,
} from "./course-asset";

function file(name: string, type: string, size = 1024) {
  return new File(["x".repeat(size)], name, { type });
}

describe("course asset validation", () => {
  it("allows common lesson material formats creators need for classes", () => {
    expect(
      isAllowedCourseAssetFile(
        file(
          "workbook.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        "lesson_material",
      ),
    ).toBe(true);
    expect(
      isAllowedCourseAssetFile(
        file(
          "slides.pptx",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
        "lesson_material",
      ),
    ).toBe(true);
    expect(
      isAllowedCourseAssetFile(file("resources.zip", "application/zip"), "lesson_material"),
    ).toBe(true);
    expect(
      isAllowedCourseAssetFile(file("audio-notes.mp3", "audio/mpeg"), "lesson_material"),
    ).toBe(true);
  });

  it("falls back to safe file extensions when browsers omit Office MIME types", () => {
    expect(isAllowedCourseAssetFile(file("worksheet.xlsx", ""), "lesson_material")).toBe(
      true,
    );
    expect(isAllowedCourseAssetFile(file("installer.exe", ""), "lesson_material")).toBe(
      false,
    );
  });

  it("registers the members-area cover kind as a labeled image asset", () => {
    expect(courseAssetKindLabels.members_cover).toBe("Members area cover");
    expect(courseAssetAcceptTypes.members_cover).toBe("image/*");
    expect(isAllowedCourseAssetFile(file("hero.jpg", "image/jpeg"), "members_cover")).toBe(
      true,
    );
    expect(isAllowedCourseAssetFile(file("hero.mp4", "video/mp4"), "members_cover")).toBe(
      false,
    );
  });
});

describe("lesson video access authorization", () => {
  const base = {
    isPreview: false,
    assetOwnerId: "teacher-1",
    callerId: "learner-9",
    enrollmentStatus: null as string | null,
    isAdmin: false,
  };

  it("denies a signed-in stranger with no enrollment (the RLS-bypass attack)", () => {
    expect(canViewCourseAssetVideo(base)).toBe(false);
  });

  it("allows free preview lessons for anyone signed in", () => {
    expect(canViewCourseAssetVideo({ ...base, isPreview: true })).toBe(true);
  });

  it("allows the teacher who owns the asset", () => {
    expect(canViewCourseAssetVideo({ ...base, callerId: "teacher-1" })).toBe(true);
  });

  it("allows active and completed enrollments only", () => {
    expect(canViewCourseAssetVideo({ ...base, enrollmentStatus: "active" })).toBe(true);
    expect(canViewCourseAssetVideo({ ...base, enrollmentStatus: "completed" })).toBe(true);
    expect(canViewCourseAssetVideo({ ...base, enrollmentStatus: "refunded" })).toBe(false);
    expect(canViewCourseAssetVideo({ ...base, enrollmentStatus: "revoked" })).toBe(false);
  });

  it("allows platform admins", () => {
    expect(canViewCourseAssetVideo({ ...base, isAdmin: true })).toBe(true);
  });
});
