import { describe, expect, it } from "vitest";
import { getPrimaryLessonVideoAsset, type CourseAsset } from "./course-asset";

const video = (id: string, createdAt?: unknown, patch: Partial<CourseAsset> = {}): CourseAsset => ({
  id, createdAt, courseId: "course", ownerId: "owner", kind: "lesson_video",
  fileName: id, contentType: "video/mp4", size: 1, storagePath: id,
  isPreview: false, lessonId: "lesson", ...patch,
});

describe("primary lesson upload", () => {
  it("selects the newest video including live recordings, independent of filename", () => {
    const older = video("z.mp4", "2026-01-01");
    const newer = video("a.mp4", "2026-02-01", { kind: "live_recording" });
    expect(getPrimaryLessonVideoAsset([newer, older])).toBe(newer);
    expect(getPrimaryLessonVideoAsset([older, newer])).toBe(newer);
  });
  it("ignores video-shaped materials and non-video lesson assets", () => {
    expect(getPrimaryLessonVideoAsset([
      video("material", "2026-01-01", { kind: "lesson_material" }),
      video("image", "2026-01-01", { contentType: "image/png" }),
    ])).toBeNull();
    expect(getPrimaryLessonVideoAsset([])).toBeNull();
  });
  it("keeps the first candidate for equal dates or when both dates are invalid", () => {
    const first = video("first", "bad");
    expect(getPrimaryLessonVideoAsset([first, video("missing")])).toBe(first);
    const dated = video("dated", "2026-01-01");
    expect(getPrimaryLessonVideoAsset([dated, video("equal", "2026-01-01")])).toBe(dated);
  });
  it("prefers a valid date over an invalid one in either order without mutating input", () => {
    const invalid = video("invalid", "bad");
    const valid = video("valid", "2026-01-01");
    const input = Object.freeze([invalid, valid]);
    expect(getPrimaryLessonVideoAsset(input)).toBe(valid);
    expect(getPrimaryLessonVideoAsset([valid, invalid])).toBe(valid);
    expect(input).toEqual([invalid, valid]);
  });
});
