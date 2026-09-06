import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateTeacherCourseBuilderInput } from "@/domain/teacher-course";
import { subscribeToTeacherCourse, updateTeacherCourseBuilder } from "@/lib/data/teacher-courses";

const mocks = vi.hoisted(() => ({
  course: vi.fn(),
  content: vi.fn(),
  rpc: vi.fn(),
  removeChannel: vi.fn(),
  listeners: new Map<string, () => void>(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => {
    const channel = {
      on: (_event: string, filter: { table: string }, callback: () => void) => {
        mocks.listeners.set(filter.table, callback);
        return channel;
      },
      subscribe: () => channel,
    };
    return {
      from: (table: string) => ({ select: () => ({
        eq: table === "courses" ? () => ({ maybeSingle: mocks.course }) : mocks.content,
      }) }),
      rpc: mocks.rpc,
      channel: () => channel,
      removeChannel: mocks.removeChannel,
    };
  },
}));

const publicRow = {
  id: "course", owner_id: "teacher", title: "Course", summary: "Course summary",
  category: "Personal development", status: "draft", community_enabled: false,
  modules: [{ id: "module", title: "Module", lessons: [{
    id: "lesson", title: "Lesson", description: "Description", type: "text",
    contentText: "stale inline content", externalUrl: "https://stale.example/lesson",
  }] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.course.mockResolvedValue({ data: publicRow, error: null });
  mocks.content.mockResolvedValue({ data: [{ lesson_id: "lesson", content_text: "Private lesson", external_url: "https://example.test/lesson" }], error: null });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe("the teacher reopens the gated lesson content", () => {
  it("loads private content before emitting and preserves it in the next save", async () => {
    let finishContent!: (value: unknown) => void;
    mocks.content.mockImplementationOnce(() => new Promise((resolve) => { finishContent = resolve; }));
    const onCourse = vi.fn();
    const stop = subscribeToTeacherCourse("course", onCourse, vi.fn());
    await vi.waitFor(() => expect(mocks.content).toHaveBeenCalled());
    expect(onCourse).not.toHaveBeenCalled();
    finishContent({ data: [{ lesson_id: "lesson", content_text: "Private lesson", external_url: "https://example.test/lesson" }], error: null });
    await vi.waitFor(() => expect(onCourse).toHaveBeenCalledOnce());
    const course = onCourse.mock.calls[0][0];
    expect(course.modules[0].lessons[0]).toMatchObject({ contentText: "Private lesson", externalUrl: "https://example.test/lesson" });
    await updateTeacherCourseBuilder("course", { ...course, categories: [course.category], learningOutcomes: [], paymentType: "free" } as UpdateTeacherCourseBuilderInput);
    expect(mocks.rpc.mock.calls[0][1].p_payload.modules[0].lessons[0]).toMatchObject({ contentText: "Private lesson", externalUrl: "https://example.test/lesson" });
    stop();
  });

  it("does not offer a writable snapshot when the private read fails", async () => {
    mocks.content.mockResolvedValueOnce({ data: null, error: new Error("private read failed") });
    const onCourse = vi.fn();
    const onError = vi.fn();
    const stop = subscribeToTeacherCourse("course", onCourse, onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onCourse).not.toHaveBeenCalled();
    stop();
  });

  it("refreshes gated changes and ignores a read that finishes after unsubscribe", async () => {
    const onCourse = vi.fn();
    const stop = subscribeToTeacherCourse("course", onCourse, vi.fn());
    await vi.waitFor(() => expect(onCourse).toHaveBeenCalledOnce());
    expect(mocks.listeners.has("course_lesson_content")).toBe(true);
    mocks.content.mockResolvedValueOnce({ data: [{ lesson_id: "lesson", content_text: null, external_url: null }], error: null });
    mocks.listeners.get("course_lesson_content")!();
    await vi.waitFor(() => expect(onCourse).toHaveBeenCalledTimes(2));
    expect(onCourse.mock.calls[1][0].modules[0].lessons[0]).toMatchObject({ contentText: null, externalUrl: null });
    let finishCourse!: (value: unknown) => void;
    mocks.course.mockImplementationOnce(() => new Promise((resolve) => { finishCourse = resolve; }));
    mocks.listeners.get("courses")!();
    stop();
    finishCourse({ data: publicRow, error: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCourse).toHaveBeenCalledTimes(2);
    expect(mocks.removeChannel).toHaveBeenCalledOnce();
  });
});
