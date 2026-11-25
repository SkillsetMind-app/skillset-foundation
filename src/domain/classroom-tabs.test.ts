import { describe, expect, it } from "vitest";

import {
  classroomBasePath,
  classroomTabHref,
  isClassroomTab,
} from "@/domain/classroom-tabs";

// Reanalysis item 9: each classroom tab is an address, and the current lesson goes along.

describe("classroom tabs: each has its own address", () => {
  it("the tab is its own base; the others get a segment, and the lesson goes along", () => {
    const base = "/learn/courses/lideranca";

    expect(classroomTabHref(base, "lesson", "aula-5")).toBe("/learn/courses/lideranca?lesson=aula-5");
    expect(classroomTabHref(base, "community", "aula-5")).toBe(
      "/learn/courses/lideranca/community?lesson=aula-5",
    );
    // No lesson chosen yet (first visit), no parameter.
    expect(classroomTabHref(base, "about", null)).toBe("/learn/courses/lideranca/about");
  });

  it("the lesson id is escaped in the address", () => {
    expect(classroomTabHref("/learn/courses/x", "materials", "a b&c")).toBe(
      "/learn/courses/x/materials?lesson=a%20b%26c",
    );
  });

  it("the base strips the segment of the open tab, and only that", () => {
    expect(classroomBasePath("/learn/courses/lideranca/community", "community")).toBe(
      "/learn/courses/lideranca",
    );
    expect(classroomBasePath("/learn/courses/lideranca", "lesson")).toBe(
      "/learn/courses/lideranca",
    );
    // A course whose slug ends the same as a tab name does not lose its slug.
    expect(classroomBasePath("/learn/courses/community", "lesson")).toBe(
      "/learn/courses/community",
    );
    // The question drawer lives INSIDE the tab: whatever comes after it is removed too.
    expect(classroomBasePath("/learn/courses/lideranca/community/q/post-1", "community")).toBe(
      "/learn/courses/lideranca",
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
