import { describe, expect, it } from "vitest";

import {
  classroomBasePath,
  classroomTabHref,
  isClassroomTab,
} from "@/domain/classroom-tabs";

// Reanalysis item 9: each classroom tab is an address, and the current lesson goes along.

describe("classroom tabs: each has its own address", () => {
  it("the tab is its own base; the others get a segment, and the lesson goes along", () => {
    const base = "/learn/courses/leadership";

    expect(classroomTabHref(base, "lesson", "lesson-5")).toBe("/learn/courses/leadership?lesson=lesson-5");
    expect(classroomTabHref(base, "community", "lesson-5")).toBe(
      "/learn/courses/leadership/community?lesson=lesson-5",
    );
    // No lesson chosen yet (first visit), no parameter.
    expect(classroomTabHref(base, "about", null)).toBe("/learn/courses/leadership/about");
  });

  it("the lesson id is escaped in the address", () => {
    expect(classroomTabHref("/learn/courses/x", "materials", "a b&c")).toBe(
      "/learn/courses/x/materials?lesson=a%20b%26c",
    );
  });

  it("the base strips the segment of the open tab, and only that", () => {
    expect(classroomBasePath("/learn/courses/leadership/community", "community")).toBe(
      "/learn/courses/leadership",
    );
    expect(classroomBasePath("/learn/courses/leadership", "lesson")).toBe(
      "/learn/courses/leadership",
    );
    // A course whose slug ends the same as a tab name does not lose its slug.
    expect(classroomBasePath("/learn/courses/community", "lesson")).toBe(
      "/learn/courses/community",
    );
    // The question drawer lives INSIDE the tab: whatever comes after it is removed too.
    expect(classroomBasePath("/learn/courses/leadership/community/q/post-1", "community")).toBe(
      "/learn/courses/leadership",
    );
    expect(classroomBasePath("/learn/courses/community/community/q/post-1", "community")).toBe(
      "/learn/courses/community",
    );
  });

  it("only the known names are tabs", () => {
    expect(isClassroomTab("community")).toBe(true);
    expect(isClassroomTab("banana")).toBe(false);
    expect(isClassroomTab("")).toBe(false);
  });
});
