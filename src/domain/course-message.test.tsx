import { describe, expect, it } from "vitest";

import {
  groupCourseMessageThreads,
  normalizeCourseMessageBody,
  type CourseMessage,
} from "@/domain/course-message";

function message(overrides: Partial<CourseMessage>): CourseMessage {
  return {
    id: "m1",
    courseId: "course-a",
    courseTitle: "Course A",
    studentId: "student-1",
    studentName: "Ana",
    teacherId: "teacher-1",
    senderId: "student-1",
    body: "Hello",
    createdAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("normalizeCourseMessageBody", () => {
  it("trims and rejects empty bodies", () => {
    expect(normalizeCourseMessageBody("  hi  ")).toBe("hi");
    expect(normalizeCourseMessageBody("   ")).toBeNull();
  });

  it("caps overlong bodies at the max length", () => {
    const long = "x".repeat(5000);
    expect(normalizeCourseMessageBody(long)?.length).toBe(2000);
  });
});

describe("groupCourseMessageThreads", () => {
  it("groups per (course, student), sorts threads by latest activity and messages oldest-first", () => {
    const threads = groupCourseMessageThreads([
      message({ id: "a2", createdAt: "2026-07-01T12:00:00.000Z", senderId: "teacher-1" }),
      message({ id: "a1", createdAt: "2026-07-01T10:00:00.000Z" }),
      message({
        id: "b1",
        courseId: "course-b",
        courseTitle: "Course B",
        studentId: "student-2",
        studentName: "Bruno",
        createdAt: "2026-07-02T09:00:00.000Z",
      }),
    ]);

    expect(threads).toHaveLength(2);
    // Bruno's thread has the newest message, so it leads the inbox.
    expect(threads[0].key).toBe("course-b__student-2");
    expect(threads[0].lastMessage.id).toBe("b1");
    // Ana's thread renders oldest-first for chat layout.
    expect(threads[1].messages.map((m) => m.id)).toEqual(["a1", "a2"]);
    expect(threads[1].lastMessage.id).toBe("a2");
  });

  it("keeps same student in two courses as two threads", () => {
    const threads = groupCourseMessageThreads([
      message({ id: "a1" }),
      message({ id: "c1", courseId: "course-c", courseTitle: "Course C" }),
    ]);
    expect(threads).toHaveLength(2);
  });
});
