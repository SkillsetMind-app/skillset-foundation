import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({ createVideo: vi.fn(), course: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "real-owner" } }, error: null }) },
  from: () => { const query = { select: () => query, eq: () => query, maybeSingle: mocks.course }; return query; },
}) }));
vi.mock("@/lib/payments/server/auth", () => ({
  assertCreatorActivated: vi.fn(), enforceRateLimit: vi.fn(), paymentErrorResponse: vi.fn(),
}));
vi.mock("@/lib/bunny/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/bunny/server")>(), createBunnyVideo: mocks.createVideo,
}));
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BUNNY_STREAM_API_KEY", "local-bunny-test-key");
  vi.stubEnv("NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID", "test-library");
  mocks.course.mockResolvedValue({ data: { id: "course-1" }, error: null });
  mocks.createVideo.mockResolvedValue("new-video");
});
afterEach(() => vi.unstubAllEnvs());

it("binds only the created video to the authenticated owner and their course", async () => {
  const response = await POST(new Request("http://localhost/api/teach/video/create", {
    method: "POST", body: JSON.stringify({ courseId: "course-1", title: "Lesson", ownerId: "forged", videoId: "copied" }),
  }));
  const mac = createHmac("sha256", "local-bunny-test-key")
    .update(JSON.stringify(["skillsetmind:bunny-asset:v1", "course-1", "real-owner", "new-video"]))
    .digest("hex");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ videoId: "new-video", storagePath: `bunny/new-video/${mac}` });
});

it("never creates or binds a video for a course the caller does not own", async () => {
  mocks.course.mockResolvedValue({ data: null, error: null });
  expect((await POST(new Request("http://localhost/api/teach/video/create", {
    method: "POST", body: JSON.stringify({ courseId: "foreign-course" }),
  }))).status).toBe(403);
  expect(mocks.createVideo).not.toHaveBeenCalled();
});
