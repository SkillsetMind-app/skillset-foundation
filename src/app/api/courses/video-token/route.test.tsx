import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  getAdmin: vi.fn(),
  signEmbed: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServer,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: mocks.getAdmin,
}));

vi.mock("@/lib/bunny/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/bunny/server")>(),
  signBunnyEmbedUrl: mocks.signEmbed,
}));

import { POST } from "@/app/api/courses/video-token/route";

function createQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };
  return query;
}

function createAdmin(...results: Array<{ data: unknown; error: unknown }>) {
  for (const result of results) {
    const row = result.data as Record<string, unknown> | null;
    if (row?.bunny_video_id && !("storage_path" in row)) {
      row.storage_path = binding(String(row.course_id), String(row.owner_id), String(row.bunny_video_id));
    }
  }
  let index = 0;
  return {
    from: vi.fn(() => createQuery(results[index++] ?? { data: null, error: null })),
  };
}

function binding(courseId: string, ownerId: string, videoId: string) {
  const receipt = createHmac("sha256", "local-bunny-test-key")
    .update(JSON.stringify(["skillsetmind:bunny-asset:v1", courseId, ownerId, videoId]))
    .digest("hex");
  return `bunny/${videoId}/${receipt}`;
}

function request(body: unknown) {
  return new Request("http://localhost/api/courses/video-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("course video token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BUNNY_STREAM_API_KEY", "local-bunny-test-key");
    mocks.createServer.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
      rpc: vi.fn(async () => ({ data: false, error: null })),
    });
    mocks.signEmbed.mockReturnValue("https://video.example/signed");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    binding("other-course", "attacker", "video-1"),
    binding("course-1", "other-owner", "video-1"),
    binding("course-1", "attacker", "other-video"),
    "bunny/video-1",
    `bunny/video-1/${"é".repeat(64)}`,
    null,
  ])("refuses a creator's forged video asset before minting playback", async (storagePath) => {
    mocks.createServer.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "attacker" } }, error: null })) },
    });
    mocks.getAdmin.mockReturnValue(createAdmin({ data: {
      bunny_video_id: "video-1", course_id: "course-1", owner_id: "attacker",
      is_preview: false, lesson_id: "lesson-1", storage_path: storagePath,
    }, error: null }));
    expect((await POST(request({ assetId: "forged" }))).status).toBe(404);
    expect(mocks.signEmbed).not.toHaveBeenCalled();
  });

  it("does not launder another course's video through the public preview", async () => {
    mocks.getAdmin.mockReturnValue(createAdmin(
      { data: { id: "course-1" }, error: null },
      { data: { bunny_video_id: "video-1", course_id: "course-1", owner_id: "attacker",
        is_preview: true, lesson_id: "lesson-1", storage_path: binding("other-course", "attacker", "video-1") }, error: null },
    ));
    expect((await POST(request({ courseId: "course-1", lessonId: "lesson-1" }))).status).toBe(404);
    expect(mocks.signEmbed).not.toHaveBeenCalled();
  });

  it("allows an anonymous visitor to play only the configured preview of a published course", async () => {
    const admin = createAdmin(
      { data: { id: "course-1" }, error: null },
      {
        data: {
          bunny_video_id: "video-1",
          course_id: "course-1",
          owner_id: "teacher-1",
          is_preview: true,
        },
        error: null,
      },
    );
    mocks.getAdmin.mockReturnValue(admin);

    const response = await POST(request({ courseId: "course-1", lessonId: "lesson-1" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ embedUrl: "https://video.example/signed" });
    expect(mocks.signEmbed).toHaveBeenCalledWith("video-1");
    expect(admin.from).toHaveBeenNthCalledWith(1, "courses");
    expect(admin.from).toHaveBeenNthCalledWith(2, "course_assets");
  });

  it("does not expose a preview when the course is not published or the lesson is not configured", async () => {
    mocks.getAdmin.mockReturnValue(createAdmin({ data: null, error: null }));

    const response = await POST(request({ courseId: "course-1", lessonId: "lesson-2" }));

    expect(response.status).toBe(404);
    expect(mocks.signEmbed).not.toHaveBeenCalled();
  });

  it("still requires authentication when selecting a protected asset by id", async () => {
    mocks.getAdmin.mockReturnValue(createAdmin());

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(401);
    expect(mocks.signEmbed).not.toHaveBeenCalled();
  });

  // Drip: enrollment alone is not the grant — the lesson also has to have opened.
  // Enrolled today on a 7-day-per-lesson course, asking for lesson 2.
  function enrolledStudentAskingForLesson(lessonId: string) {
    mocks.createServer.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: "student-1" } }, error: null })),
      },
      rpc: vi.fn(async () => ({ data: false, error: null })),
    });
    return createAdmin(
      {
        data: {
          bunny_video_id: "video-2",
          course_id: "course-1",
          owner_id: "teacher-1",
          is_preview: false,
          lesson_id: lessonId,
        },
        error: null,
      },
      { data: { status: "active", created_at: new Date().toISOString() }, error: null },
      {
        data: {
          drip_strategy: "time_drip_lesson",
          drip_interval_days: 7,
          free_preview_lesson_id: null,
          modules: [{ lessons: [{ id: "lesson-1" }, { id: "lesson-2" }] }],
        },
        error: null,
      },
    );
  }

  it("refuses to sign a lesson the drip schedule has not opened yet", async () => {
    mocks.getAdmin.mockReturnValue(enrolledStudentAskingForLesson("lesson-2"));

    const response = await POST(request({ assetId: "asset-2" }));

    expect(response.status).toBe(404);
    expect(mocks.signEmbed).not.toHaveBeenCalled();
  });

  it("signs a lesson that is already open on the drip schedule", async () => {
    mocks.getAdmin.mockReturnValue(enrolledStudentAskingForLesson("lesson-1"));

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(200);
    expect(mocks.signEmbed).toHaveBeenCalledWith("video-2");
  });

  it("rejects ambiguous selectors", async () => {
    mocks.getAdmin.mockReturnValue(createAdmin());

    const response = await POST(
      request({ assetId: "asset-1", courseId: "course-1", lessonId: "lesson-1" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.signEmbed).not.toHaveBeenCalled();
  });
});
