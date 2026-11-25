import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseUploadLimitBytes } from "@/domain/course-asset";
import {
  uploadCourseAsset,
  uploadLessonVideoToBunny,
  type UploadCourseAssetProgress,
} from "@/lib/data/course-assets";

const mocks = vi.hoisted(() => ({
  getPublicUrl: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("tus-js-client", () => ({ Upload: class {
  onSuccess: () => void;
  constructor(_file: File, options: { onSuccess: () => void }) { this.onSuccess = options.onSuccess; }
  start() { this.onSuccess(); }
} }));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    storage: {
      from: () => ({
        upload: mocks.upload,
        getPublicUrl: mocks.getPublicUrl,
        remove: mocks.remove,
      }),
    },
    from: () => ({ insert: mocks.insert }),
  }),
}));

function imageFile(size = 1024) {
  const file = new File(["x"], "capa.png", { type: "image/png" });
  // `size` is a getter on Blob; overriding it avoids allocating tens of MB in the test.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function input(
  file: File,
  onProgress?: (progress: UploadCourseAssetProgress) => void,
) {
  return {
    courseId: "course-1",
    ownerId: "owner-1",
    kind: "module_cover" as const,
    file,
    isPreview: false,
    moduleId: "module-1",
    onProgress,
  };
}

describe("uploadCourseAsset — progresso honesto", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    mocks.upload.mockReset();
    mocks.upload.mockResolvedValue({ error: null });
    mocks.insert.mockReset();
    mocks.insert.mockResolvedValue({ error: null });
    mocks.remove.mockReset();
    mocks.remove.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockReset();
    mocks.getPublicUrl.mockReturnValue({
      data: { publicUrl: "https://project.supabase.co/storage/v1/object/public/public-media/capa.png" },
    });
  });

  it("persists the server's Bunny receipt without manufacturing a video identity", async () => {
    const storagePath = "bunny/new-video/server-receipt";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      videoId: "new-video", storagePath, libraryId: "test-library", signature: "upload-proof",
      expires: 100, endpoint: "https://video.example/tus",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["video"], "lesson.mp4", { type: "video/mp4" });
    await uploadLessonVideoToBunny({ courseId: "course-1", ownerId: "owner-1", kind: "lesson_video",
      file, isPreview: false, lessonId: "lesson-1" });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      bunny_video_id: "new-video", storage_path: storagePath, owner_id: "owner-1", course_id: "course-1",
    }));
  });

  // supabase-js upload() does not report progress. Emitting 0% and sitting there
  // for the whole upload read as "stuck" — and the natural reaction was to close the tab.
  it("does not invent a percentage while Storage uploads: percent is null", async () => {
    const events: UploadCourseAssetProgress[] = [];

    await uploadCourseAsset(input(imageFile(), (progress) => events.push(progress)));

    const running = events.filter((event) => event.state === "running");
    expect(running.length).toBeGreaterThan(0);
    for (const event of running) {
      expect(event.percent).toBeNull();
    }
  });

  it("only emits 'success' after the row exists in the database", async () => {
    const events: UploadCourseAssetProgress[] = [];
    mocks.insert.mockResolvedValueOnce({ error: new Error("insert failed") });

    await expect(
      uploadCourseAsset(input(imageFile(), (progress) => events.push(progress))),
    ).rejects.toThrow("insert failed");

    // Before, the 100% came out between the byte upload and the insert: the screen showed
    // "Upload complete 100%" on top of the red failure box.
    expect(events.some((event) => event.state === "success")).toBe(false);
  });

  it("emits 'success' with 100% when everything was stored", async () => {
    const events: UploadCourseAssetProgress[] = [];

    await uploadCourseAsset(input(imageFile(), (progress) => events.push(progress)));

    const last = events.at(-1);
    expect(last?.state).toBe("success");
    expect(last?.percent).toBe(100);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  // The plan cap (50 MB) beats the bucket's (500 MB). An 80 MB PNG used to pass
  // the type validation and fall into a 413 — or worse, into the generic message.
  it("refuses above the effective cap with the limit message, before touching Storage", async () => {
    await expect(
      uploadCourseAsset(input(imageFile(supabaseUploadLimitBytes + 1))),
    ).rejects.toThrow(/exceeds the current upload limit/);

    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
