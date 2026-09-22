import { beforeEach, expect, it, vi } from "vitest";
import { activateUploadedLessonVideo } from "./lesson-video-selection";
import { runCourseWrite } from "./course-write-queue";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => mocks }));

beforeEach(() => vi.resetAllMocks());

function query(result: unknown) {
  const chain = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), update: vi.fn(),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of [chain.select, chain.eq, chain.in, chain.update]) method.mockReturnValue(chain);
  return chain;
}

function asset() {
  const chain = query({ data: { id: "video" }, error: null });
  mocks.from.mockReturnValueOnce(chain);
  return chain;
}

it("selects the uploaded video without replacing unrelated curriculum edits", async () => {
  const check = asset();
  const original = [{ id: "m", title: "Latest title", lessons: [{ id: "l", title: "Latest lesson", videoSource: "youtube", externalUrl: "kept" }, { id: "other", title: "Untouched" }] }];
  mocks.from.mockReturnValueOnce(query({ data: { modules: original }, error: null }));
  const saved = query({ data: [{ id: "c" }], error: null });
  mocks.from.mockReturnValueOnce(saved);
  await activateUploadedLessonVideo("c", "l", "video");
  expect(check.eq.mock.calls).toEqual([["id", "video"], ["course_id", "c"], ["lesson_id", "l"]]);
  expect(check.in).toHaveBeenCalledWith("kind", ["lesson_video", "live_recording"]);
  expect(saved.eq).toHaveBeenCalledWith("modules", JSON.stringify(original));
  expect(saved.update).toHaveBeenCalledWith({ modules: [{ ...original[0], lessons: [{ ...original[0].lessons[0], videoSource: "upload" }, original[0].lessons[1]] }] });
});

it("reads again after a concurrent save instead of forcing stale data", async () => {
  asset();
  const writes: ReturnType<typeof query>[] = [];
  for (const title of ["Before", "Concurrent edit"]) {
    mocks.from.mockReturnValueOnce(query({ data: { modules: [{ title, lessons: [{ id: "l" }] }] }, error: null }));
    const write = query({ data: title === "Before" ? [] : [{ id: "c" }], error: null });
    writes.push(write);
    mocks.from.mockReturnValueOnce(write);
  }
  await activateUploadedLessonVideo("c", "l", "video");
  expect(mocks.from).toHaveBeenCalledTimes(5);
  expect(writes[1].update).toHaveBeenCalledWith({ modules: [{ title: "Concurrent edit", lessons: [{ id: "l", videoSource: "upload" }] }] });
});

it("stops after three conflicts and leaves the saved video recoverable", async () => {
  asset();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    mocks.from.mockReturnValueOnce(query({ data: { modules: [{ lessons: [{ id: "l" }] }] }, error: null }));
    mocks.from.mockReturnValueOnce(query({ data: [], error: null }));
  }
  await expect(activateUploadedLessonVideo("c", "l", "video")).rejects.toThrow("edited elsewhere");
  expect(mocks.from).toHaveBeenCalledTimes(7);
});

it("does not write when the asset is missing or inaccessible", async () => {
  mocks.from.mockReturnValueOnce(query({ data: null, error: null }));
  await expect(activateUploadedLessonVideo("c", "l", "video")).rejects.toThrow("no longer available");
  expect(mocks.from).toHaveBeenCalledTimes(1);
});

it("does not recreate a lesson removed during upload", async () => {
  asset();
  mocks.from.mockReturnValueOnce(query({ data: { modules: [] }, error: null }));
  await expect(activateUploadedLessonVideo("c", "l", "video")).rejects.toThrow("lesson changed");
  expect(mocks.from).toHaveBeenCalledTimes(2);
});

it("surfaces denied writes without treating them as success", async () => {
  asset();
  mocks.from.mockReturnValueOnce(query({ data: { modules: [{ lessons: [{ id: "l" }] }] }, error: null }));
  mocks.from.mockReturnValueOnce(query({ data: null, error: new Error("denied") }));
  await expect(activateUploadedLessonVideo("c", "l", "video")).rejects.toThrow("denied");
});

it("waits for an earlier course save before reading the curriculum", async () => {
  let finish!: () => void;
  const saving = runCourseWrite("c", () => new Promise<void>((resolve) => { finish = resolve; }));
  await Promise.resolve();
  await Promise.resolve();
  asset();
  mocks.from.mockReturnValueOnce(query({ data: { modules: [{ title: "Saved first", lessons: [{ id: "l" }] }] }, error: null }));
  const saved = query({ data: [{ id: "c" }], error: null });
  mocks.from.mockReturnValueOnce(saved);
  const connecting = activateUploadedLessonVideo("c", "l", "video");
  expect(mocks.from).not.toHaveBeenCalled();
  finish();
  await saving;
  await connecting;
  expect(saved.update).toHaveBeenCalledWith({ modules: [{ title: "Saved first", lessons: [{ id: "l", videoSource: "upload" }] }] });
});

it("does not write after the account changes during the curriculum read", async () => {
  asset();
  let finish!: (value: unknown) => void;
  const read = query(null);
  read.single.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  mocks.from.mockReturnValueOnce(read);
  let active = true;
  const connecting = activateUploadedLessonVideo("c", "l", "video", () => {
    if (!active) throw new Error("session changed");
  });
  await vi.waitFor(() => expect(read.single).toHaveBeenCalledOnce());
  active = false;
  finish({ data: { modules: [{ lessons: [{ id: "l" }] }] }, error: null });
  await expect(connecting).rejects.toThrow("session changed");
  expect(mocks.from).toHaveBeenCalledTimes(2);
});
