import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), asset: vi.fn(), course: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/payments/server/auth")>(),
  enforceRateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: mocks.user },
  from: (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: table === "course_assets" ? mocks.asset : mocks.course,
    };
    return query;
  },
}) }));

import { signBunnyAssetPath } from "@/lib/bunny/server";
import { PaymentError } from "@/lib/payments/server/auth";
import { GET } from "./route";

// fetch is mocked: nothing reaches Bunny. The request host is example.test.
const fetchMock = vi.fn();
const statusRequest = (assetId = "asset-1") =>
  new Request(`https://example.test/api/teach/video/status?assetId=${assetId}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BUNNY_STREAM_API_KEY", "local-bunny-test-key");
  vi.stubEnv("NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID", "test-library");
  vi.stubGlobal("fetch", fetchMock);
  mocks.user.mockResolvedValue({ data: { user: { id: "real-owner" } }, error: null });
  mocks.asset.mockResolvedValue({
    data: {
      course_id: "course-1",
      bunny_video_id: "vid-1",
      storage_path: signBunnyAssetPath("course-1", "real-owner", "vid-1"),
    },
    error: null,
  });
  mocks.course.mockResolvedValue({ data: { id: "course-1" }, error: null });
  mocks.rateLimit.mockResolvedValue(undefined);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      guid: "vid-1", title: "Internal title", status: 4, encodeProgress: 100, length: 125, storageSize: 999,
    }),
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("answers 401 when nobody is signed in, without calling Bunny", async () => {
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });

  expect((await GET(statusRequest())).status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("answers 404 for someone else's asset, without calling Bunny", async () => {
  // The course is not the caller's.
  mocks.course.mockResolvedValue({ data: null, error: null });
  expect((await GET(statusRequest())).status).toBe(404);

  // RLS hides the row.
  mocks.asset.mockResolvedValueOnce({ data: null, error: null });
  expect((await GET(statusRequest())).status).toBe(404);

  // A video id copied into the caller's own course: the receipt does not match.
  mocks.course.mockResolvedValue({ data: { id: "course-2" }, error: null });
  mocks.asset.mockResolvedValue({
    data: {
      course_id: "course-2",
      bunny_video_id: "vid-1",
      storage_path: signBunnyAssetPath("course-1", "real-owner", "vid-1"),
    },
    error: null,
  });
  expect((await GET(statusRequest())).status).toBe(404);

  expect(fetchMock).not.toHaveBeenCalled();
});

it("answers 200 with only status, encodeProgress and lengthSeconds", async () => {
  const response = await GET(statusRequest());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 4, encodeProgress: 100, lengthSeconds: 125 });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/library\/test-library\/videos\/vid-1$/);
});

it("answers 503 when Bunny fails, so the studio can try again later", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

  const response = await GET(statusRequest());

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Video host unavailable." });
});

// Deleted on Bunny is permanent: 404 makes the studio stop, instead of the
// 503 it would keep retrying.
it("answers 404 when the video was deleted on Bunny", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

  const response = await GET(statusRequest());

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Video not found." });
});

it("limits each owner to 1000 checks per hour and answers 429 over it, without calling Bunny", async () => {
  expect((await GET(statusRequest())).status).toBe(200);
  expect(mocks.rateLimit).toHaveBeenCalledWith("teach_video_status_real-owner", 1000, 60 * 60 * 1000);

  fetchMock.mockClear();
  mocks.rateLimit.mockRejectedValueOnce(
    new PaymentError("Too many attempts. Please wait before trying again.", 429),
  );
  expect((await GET(statusRequest())).status).toBe(429);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("answers 503, not 404, when a database query fails, so the studio keeps polling", async () => {
  mocks.asset.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
  expect((await GET(statusRequest())).status).toBe(503);

  mocks.course.mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
  expect((await GET(statusRequest())).status).toBe(503);

  expect(fetchMock).not.toHaveBeenCalled();
});

it("gives the Bunny call an 8 s timeout, and a hang becomes the 503 retry path", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");

  await GET(statusRequest());
  expect(timeout).toHaveBeenCalledWith(8000);
  expect(fetchMock.mock.calls[0][1]).toEqual(
    expect.objectContaining({ signal: timeout.mock.results[0].value }),
  );

  fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
  expect((await GET(statusRequest())).status).toBe(503);
  timeout.mockRestore();
});
