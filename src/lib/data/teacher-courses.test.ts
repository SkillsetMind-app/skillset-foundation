import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateTeacherCourseBuilderInput } from "@/domain/teacher-course";
import { clearLessonVideoSelection, invalidateCourseWrites, recordLessonVideoSelection, runCourseWrite } from "./course-write-queue";
import {
  deleteOrArchiveCourse,
  subscribeToTeacherCourse,
  updateTeacherCourseBuilder,
} from "@/lib/data/teacher-courses";

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
  invalidateCourseWrites();
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.course.mockResolvedValue({ data: publicRow, error: null });
  mocks.content.mockResolvedValue({ data: [{ lesson_id: "lesson", content_text: "Private lesson", external_url: "https://example.test/lesson" }], error: null });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe("the teacher reopens the gated lesson content", () => {
  it("does not overwrite a newer source selected in another tab after a completed upload", async () => {
    recordLessonVideoSelection("course", "lesson", "upload", "2026-09-22T12:00:00.000100Z");
    mocks.course.mockResolvedValue({ data: { ...publicRow, updated_at: "2026-09-22T12:00:00.000200Z", modules: [{ ...publicRow.modules[0], lessons: [{ ...publicRow.modules[0].lessons[0], videoSource: "youtube" }] }] }, error: null });
    const onCourse = vi.fn();
    const stop = subscribeToTeacherCourse("course", onCourse, vi.fn());
    await vi.waitFor(() => expect(onCourse).toHaveBeenCalledOnce());
    await updateTeacherCourseBuilder("course", { ...onCourse.mock.calls[0][0], title: "New title", learningOutcomes: [], paymentType: "free" });
    expect(mocks.rpc.mock.calls[0][1].p_payload.modules[0].lessons[0].videoSource).toBe("youtube");
    stop();
  });

  it("reconciles a queued stale draft after upload without losing title edits or a later explicit selection", async () => {
    const onCourse = vi.fn();
    const stop = subscribeToTeacherCourse("course", onCourse, vi.fn());
    await vi.waitFor(() => expect(onCourse).toHaveBeenCalledOnce());
    const input = { ...onCourse.mock.calls[0][0], title: "Edited title", learningOutcomes: [], paymentType: "free" } as UpdateTeacherCourseBuilderInput;
    let finish!: () => void;
    const upload = runCourseWrite("course", async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      recordLessonVideoSelection("course", "lesson", "upload");
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    const save = updateTeacherCourseBuilder("course", input);
    finish();
    await upload;
    await save;
    expect(mocks.rpc.mock.calls[0][1].p_payload).toMatchObject({ title: "Edited title", modules: [{ lessons: [{ videoSource: "upload" }] }] });
    clearLessonVideoSelection("course", "lesson");
    input.modules[0].lessons[0].videoSource = "youtube";
    await updateTeacherCourseBuilder("course", input);
    expect(mocks.rpc.mock.calls[1][1].p_payload.modules[0].lessons[0].videoSource).toBe("youtube");
    mocks.rpc.mockResolvedValueOnce({ error: new Error("offline") });
    await expect(updateTeacherCourseBuilder("course", input)).rejects.toThrow("offline");
    const reopened = structuredClone(input);
    reopened.modules[0].lessons[0].videoSource = "upload";
    reopened.modules[0].lessons[0].externalUrl = null;
    await updateTeacherCourseBuilder("course", reopened);
    expect(mocks.rpc.mock.calls[3][1].p_payload.modules[0].lessons[0]).toMatchObject({ videoSource: "upload", externalUrl: null });
    stop();
  });

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

describe("uma acao, dois destinos", () => {
  // O app deixou de chamar `delete_teacher_course_draft`: ela so aceitava
  // rascunho, e era por isso que o professor de um curso publicado nao tinha
  // saida. Quem decide entre apagar e arquivar agora e a RPC nova.
  it("chama delete_or_archive_own_course com o id e devolve o destino do servidor", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { outcome: "archived", enrollments: 2, orders: 2 },
      error: null,
    });

    await expect(deleteOrArchiveCourse("course")).resolves.toEqual({
      outcome: "archived",
      enrollments: 2,
      orders: 2,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("delete_or_archive_own_course", {
      p_course_id: "course",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("delete_teacher_course_draft", expect.anything());
  });

  it("propaga o erro do servidor em vez de fingir que apagou", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("Course not found.") });

    await expect(deleteOrArchiveCourse("course")).rejects.toThrow("Course not found.");
  });
});
