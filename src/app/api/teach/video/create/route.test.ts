import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({
  createVideo: vi.fn(), course: vi.fn(), assertActivated: vi.fn(), rpc: vi.fn(), rateLimit: vi.fn(), freePlan: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "real-owner" } }, error: null }) },
  from: () => { const query = { select: () => query, eq: () => query, maybeSingle: mocks.course }; return query; },
  rpc: mocks.rpc,
}) }));
vi.mock("@/lib/payments/server/auth", () => ({
  assertCreatorActivated: mocks.assertActivated, enforceRateLimit: mocks.rateLimit, isOnFreePlan: mocks.freePlan,
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
  mocks.freePlan.mockResolvedValue(false);
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
// The key keeps its old name so counters already in the table carry over.
const freeCap = ["teach_video_create_unpaid_real-owner", 20, 24 * 60 * 60 * 1000];

it("puts a Free-plan owner under the daily video cap", async () => {
  mocks.freePlan.mockResolvedValue(true);
  expect((await create()).status).toBe(200);
  expect(mocks.freePlan).toHaveBeenCalledWith("real-owner");
  expect(mocks.rateLimit).toHaveBeenCalledWith(...freeCap);
});

it("stops a Free-plan owner over the daily cap with a 429 that names no fee, before any Bunny video exists", async () => {
  mocks.freePlan.mockResolvedValue(true);
  mocks.rateLimit.mockImplementation(async (key: string) => {
    if (key.startsWith("teach_video_create_unpaid_")) throw Object.assign(new Error("Too many"), { status: 429 });
  });
  const response = await create();
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({
    error: "Daily upload limit without a plan. Try again tomorrow.",
    code: "free_plan_daily_limit",
  });
  expect(mocks.createVideo).not.toHaveBeenCalled();
});

it("leaves a paid-plan owner with the hourly throttle only", async () => {
  expect((await create()).status).toBe(200);
  expect(mocks.rateLimit).not.toHaveBeenCalledWith(...freeCap);
});

// The cap follows the plan, never require_activation_fee.
it("never asks the activation gate", async () => {
  mocks.freePlan.mockResolvedValue(true);
  await create();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.assertActivated).not.toHaveBeenCalled();
});
