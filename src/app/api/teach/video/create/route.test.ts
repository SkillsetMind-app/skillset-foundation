import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({
  createVideo: vi.fn(), course: vi.fn(), assertActivated: vi.fn(), blocked: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "real-owner" } }, error: null }) },
  from: () => { const query = { select: () => query, eq: () => query, maybeSingle: mocks.course }; return query; },
  rpc: (name: string) => (name === "creator_activation_blocked" ? mocks.blocked() : Promise.reject(new Error(name))),
}) }));
vi.mock("@/lib/payments/server/auth", () => ({
  assertCreatorActivated: mocks.assertActivated, enforceRateLimit: mocks.rateLimit,
  paymentErrorResponse: () => new Response(null, { status: 429 }),
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
  mocks.blocked.mockResolvedValue({ data: false, error: null });
  mocks.rateLimit.mockResolvedValue(undefined);
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

// Uploading is part of building the course; the one-time activation fee is
// charged at the first Publish, so an unpaid owner still gets an upload.
it("creates the upload for an owner who has not paid the activation fee", async () => {
  mocks.assertActivated.mockRejectedValue(new Error("activation_required"));
  const response = await POST(new Request("http://localhost/api/teach/video/create", {
    method: "POST", body: JSON.stringify({ courseId: "course-1", title: "Lesson" }),
  }));
  expect(response.status).toBe(200);
  expect(mocks.assertActivated).not.toHaveBeenCalled();
  expect(mocks.createVideo).toHaveBeenCalledTimes(1);
});

const create = () => POST(new Request("http://localhost/api/teach/video/create", {
  method: "POST", body: JSON.stringify({ courseId: "course-1", title: "Lesson" }),
}));
const unpaidCap = ["teach_video_create_unpaid_real-owner", 20, 24 * 60 * 60 * 1000];

it("puts an unpaid owner under the daily video cap", async () => {
  mocks.blocked.mockResolvedValue({ data: true, error: null });
  expect((await create()).status).toBe(200);
  expect(mocks.rateLimit).toHaveBeenCalledWith(...unpaidCap);
});

it("stops an unpaid owner over the daily cap before any Bunny video exists", async () => {
  mocks.blocked.mockResolvedValue({ data: true, error: null });
  mocks.rateLimit.mockImplementation(async (key: string) => {
    if (key.startsWith("teach_video_create_unpaid_")) throw new Error("RATE_LIMIT");
  });
  expect((await create()).status).toBe(429);
  expect(mocks.createVideo).not.toHaveBeenCalled();
});

it("leaves a paid owner with the hourly throttle only", async () => {
  expect((await create()).status).toBe(200);
  expect(mocks.rateLimit).not.toHaveBeenCalledWith(...unpaidCap);
});

it("fails closed when the activation status cannot be read", async () => {
  mocks.blocked.mockResolvedValue({ data: null, error: { message: "boom" } });
  expect((await create()).status).toBe(500);
  expect(mocks.createVideo).not.toHaveBeenCalled();
});
