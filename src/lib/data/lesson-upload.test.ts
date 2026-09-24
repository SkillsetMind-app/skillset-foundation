import { beforeEach, expect, it, vi } from "vitest";
import { uploadCourseAsset, uploadLessonVideoToBunny } from "./course-assets";
import { activateUploadedLessonVideo } from "./lesson-video-selection";
import { cancelLessonUpload, getLessonUpload, retryLessonVideoConnection, setLessonUploadActor, startLessonUpload, subscribeLessonUpload } from "./lesson-upload";

vi.mock("./course-assets", () => ({
  CourseAssetUploadCancelled: class extends Error {},
  uploadCourseAsset: vi.fn(), uploadLessonVideoToBunny: vi.fn(),
}));
vi.mock("./lesson-video-selection", () => ({ activateUploadedLessonVideo: vi.fn() }));

const input = () => ({ actorId: "teacher", ownerId: "teacher", courseId: "course", lessonId: "lesson", moduleId: "module", kind: "lesson_video" as const, file: new File(["video"], "lesson.mp4", { type: "video/mp4" }), isPreview: false, useBunny: true });

beforeEach(() => {
  setLessonUploadActor(null);
  vi.resetAllMocks();
  setLessonUploadActor("teacher");
});

it.each([false, true])("finishes and persists after the editor unsubscribes (Bunny: %s)", async (useBunny) => {
  let finish!: (id: string) => void;
  const transport = useBunny ? uploadLessonVideoToBunny : uploadCourseAsset;
  vi.mocked(transport).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const observer = vi.fn();
  const unsubscribe = subscribeLessonUpload(observer);
  const pending = startLessonUpload({ ...input(), useBunny });
  expect(getLessonUpload()?.status).toBe("uploading");
  unsubscribe();
  const callsBeforeLeaving = observer.mock.calls.length;
  finish("asset");
  await pending;
  expect(observer).toHaveBeenCalledTimes(callsBeforeLeaving);
  expect(activateUploadedLessonVideo).toHaveBeenCalledWith("course", "lesson", "asset", expect.any(Function));
  expect(getLessonUpload()).toMatchObject({ status: "success", assetId: "asset", lessonId: "lesson" });
});

it("retries a failed connection without uploading the bytes again", async () => {
  vi.mocked(uploadLessonVideoToBunny).mockResolvedValue("asset");
  vi.mocked(activateUploadedLessonVideo).mockRejectedValueOnce(new Error("conflict"));
  await expect(startLessonUpload(input())).rejects.toThrow("conflict");
  expect(getLessonUpload()).toMatchObject({ status: "error", assetId: "asset" });
  await retryLessonVideoConnection();
  expect(uploadLessonVideoToBunny).toHaveBeenCalledTimes(1);
  expect(activateUploadedLessonVideo).toHaveBeenCalledTimes(2);
  expect(getLessonUpload()?.status).toBe("success");
});

it("does not commit or expose a previous account's result after account change", async () => {
  let finish!: (id: string) => void;
  vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = startLessonUpload(input());
  const callbacks = vi.mocked(uploadLessonVideoToBunny).mock.calls[0][0];
  setLessonUploadActor("other");
  expect(() => callbacks.beforeCommit?.()).toThrow();
  finish("asset");
  await expect(pending).rejects.toBeInstanceOf(Error);
  expect(activateUploadedLessonVideo).not.toHaveBeenCalled();
  expect(getLessonUpload()).toBeNull();
});

it("offers cancellation only after the transport provides an abort callback", async () => {
  let finish!: (id: string) => void;
  vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = startLessonUpload(input());
  cancelLessonUpload();
  expect(getLessonUpload()?.status).toBe("uploading");
  expect(getLessonUpload()?.canCancel).not.toBe(true);
  const abort = vi.fn();
  vi.mocked(uploadLessonVideoToBunny).mock.calls[0][0].onCancelAvailable?.(abort);
  expect(getLessonUpload()?.canCancel).toBe(true);
  cancelLessonUpload();
  expect(abort).toHaveBeenCalledOnce();
  finish("asset");
  await expect(pending).rejects.toBeInstanceOf(Error);
  expect(activateUploadedLessonVideo).not.toHaveBeenCalled();
  expect(getLessonUpload()?.status).toBe("cancelled");
});

it.each([false, true])("does not cancel nonabortable storage or Bunny fallback (Bunny entry: %s)", async (useBunny) => {
  let finish!: (id: string) => void;
  const transport = useBunny ? uploadLessonVideoToBunny : uploadCourseAsset;
  vi.mocked(transport).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = startLessonUpload({ ...input(), useBunny });
  cancelLessonUpload();
  expect(getLessonUpload()?.status).toBe("uploading");
  expect(getLessonUpload()?.canCancel).not.toBe(true);
  finish("asset");
  await pending;
  expect(getLessonUpload()?.status).toBe("success");
  expect(activateUploadedLessonVideo).toHaveBeenCalledOnce();
});

it("aborts a late transport callback after account invalidation", async () => {
  let finish!: (id: string) => void;
  vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = startLessonUpload(input());
  setLessonUploadActor(null);
  const abort = vi.fn();
  vi.mocked(uploadLessonVideoToBunny).mock.calls[0][0].onCancelAvailable?.(abort);
  expect(abort).toHaveBeenCalledOnce();
  finish("asset");
  await expect(pending).rejects.toBeInstanceOf(Error);
  expect(getLessonUpload()).toBeNull();
});

it("rejects a second upload while the first one is active", async () => {
  let finish!: (id: string) => void;
  vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = startLessonUpload(input());
  await expect(startLessonUpload({ ...input(), lessonId: "other" })).rejects.toThrow("previous upload");
  finish("asset");
  await pending;
  expect(uploadLessonVideoToBunny).toHaveBeenCalledTimes(1);
});

it("does not report cancellation while the asset is being committed", async () => {
  let finish!: (id: string) => void;
  vi.mocked(uploadLessonVideoToBunny).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = startLessonUpload(input());
  const abort = vi.fn();
  vi.mocked(uploadLessonVideoToBunny).mock.calls[0][0].onCancelAvailable?.(abort);
  expect(getLessonUpload()?.canCancel).toBe(true);
  vi.mocked(uploadLessonVideoToBunny).mock.calls[0][0].beforeCommit?.();
  expect(getLessonUpload()?.status).toBe("connecting");
  expect(getLessonUpload()?.canCancel).toBe(false);
  cancelLessonUpload();
  expect(abort).not.toHaveBeenCalled();
  finish("asset");
  await pending;
  expect(getLessonUpload()?.status).toBe("success");
});
