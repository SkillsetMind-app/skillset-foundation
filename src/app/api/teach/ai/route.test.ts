// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Nada sai daqui: Supabase, Bunny e IA são falsos. O que se confere é a ordem
// dos portões e o que a rota grava, cobra e devolve.
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  isTeacher: vi.fn(),
  course: vi.fn(),
  asset: vi.fn(),
  rateLimit: vi.fn(),
  activated: vi.fn(),
  adminRpc: vi.fn(),
  adminCalls: [] as { table: string; ops: [string, unknown[]][] }[],
  adminResult: vi.fn(),
  transcribe: vi.fn(),
  translate: vi.fn(),
  videoStatus: vi.fn(),
  putCaption: vi.fn(),
  deleteCaption: vi.fn(),
  generateQuiz: vi.fn(),
  suggest: vi.fn(),
}));

vi.mock("@/lib/payments/server/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments/server/auth")>()),
  enforceRateLimit: mocks.rateLimit,
  assertCreatorActivated: mocks.activated,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.user },
    rpc: mocks.isTeacher,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: table === "course_assets" ? mocks.asset : mocks.course,
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    rpc: mocks.adminRpc,
    from: (table: string) => {
      const call = { table, ops: [] as [string, unknown[]][] };
      mocks.adminCalls.push(call);
      const query: Record<string, unknown> = {};
      for (const op of ["select", "eq", "in", "order", "update", "upsert", "delete"]) {
        query[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return query;
        };
      }
      const settle = () => mocks.adminResult(call);
      query.maybeSingle = settle;
      query.single = settle;
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(settle()).then(resolve, reject);
      return query;
    },
  }),
}));
vi.mock("@/lib/ai/captions", () => ({ transcribeLessonVideo: mocks.transcribe, translateVtt: mocks.translate }));
vi.mock("@/lib/ai/lesson-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/lesson-text")>()),
  generateQuiz: mocks.generateQuiz,
  suggestTitleAndDescription: mocks.suggest,
}));
vi.mock("@/lib/bunny/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bunny/server")>()),
  getBunnyVideoStatus: mocks.videoStatus,
  putBunnyCaption: mocks.putCaption,
  deleteBunnyCaption: mocks.deleteCaption,
}));

import { OpenAIError } from "@/lib/ai/openai";
import { signBunnyAssetPath } from "@/lib/bunny/server";

import { GET, POST } from "./route";

const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n";
const quizQuestion = { question: "What is a habit loop?", options: ["Cue, routine, reward", "A list"], answer: 0, explanation: "Said at the start." };
const row = (over: Record<string, unknown> = {}) => ({
  language: "en", vtt: VTT, video_id: "vid-1", updated_at: "2026-11-14T00:00:00Z", published_at: null, ...over,
});
const post = (body: Record<string, unknown>) =>
  POST(new Request("https://example.test/api/teach/ai", {
    method: "POST",
    body: JSON.stringify({ courseId: "course-1", lessonId: "l1", assetId: "asset-1", ...body }),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.adminCalls.length = 0;
  vi.stubEnv("BUNNY_STREAM_API_KEY", "local-bunny-test-key");
  vi.stubEnv("NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID", "test-library");
  vi.stubEnv("BUNNY_STREAM_CDN_HOSTNAME", "vz-test.b-cdn.net");
  mocks.user.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
  mocks.isTeacher.mockResolvedValue({ data: true, error: null });
  mocks.activated.mockResolvedValue(undefined);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.course.mockResolvedValue({
    data: { id: "course-1", modules: [{ id: "m1", lessons: [{ id: "l1" }] }] },
    error: null,
  });
  mocks.asset.mockResolvedValue({
    data: {
      course_id: "course-1",
      lesson_id: "l1",
      bunny_video_id: "vid-1",
      storage_path: signBunnyAssetPath("course-1", "owner-1", "vid-1"),
    },
    error: null,
  });
  mocks.videoStatus.mockResolvedValue({ status: 4, encodeProgress: 100, lengthSeconds: 125.4 });
  mocks.adminRpc.mockResolvedValue({ data: [{ usage_id: 7, used_seconds: 126, limit_seconds: 7200 }], error: null });
  mocks.adminResult.mockImplementation(({ table, ops }: { table: string; ops: [string, unknown[]][] }) => {
    if (table === "lesson_captions" && ops.some(([op]) => op === "upsert" || op === "update")) {
      return { data: row(), error: null };
    }
    return { data: null, error: null };
  });
  mocks.transcribe.mockResolvedValue(VTT);
});
afterEach(() => vi.unstubAllEnvs());

describe("gates", () => {
  it("answers 401 without a session and spends nothing", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    expect((await post({ action: "transcribe", language: "en" })).status).toBe(401);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("answers 403 to a student and to a teacher who does not own the course", async () => {
    mocks.isTeacher.mockResolvedValueOnce({ data: false, error: null });
    expect((await post({ action: "transcribe", language: "en" })).status).toBe(403);
    mocks.course.mockResolvedValueOnce({ data: null, error: null });
    expect((await post({ action: "transcribe", language: "en" })).status).toBe(403);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("answers 404 for a lesson that is not in the course", async () => {
    expect((await post({ action: "transcribe", language: "en", lessonId: "other" })).status).toBe(404);
  });
});

describe("transcribe", () => {
  it("claims the rounded-up video length, reads the 240p MP4 with the Referer and saves a draft", async () => {
    const response = await post({ action: "transcribe", language: "es" });
    expect(response.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith("claim_ai_video_seconds", {
      p_uid: "owner-1", p_course_id: "course-1", p_lesson_id: "l1", p_seconds: 126,
    });
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.objectContaining({
      videoUrl: "https://vz-test.b-cdn.net/vid-1/play_240p.mp4",
      referer: "https://skillsetmind.com/",
      language: "es",
    }));
    const upsert = mocks.adminCalls.find((c) => c.ops.some(([op]) => op === "upsert"));
    expect(upsert?.ops.find(([op]) => op === "upsert")?.[1][0]).toMatchObject({
      lesson_id: "l1", language: "es", owner_id: "owner-1", video_id: "vid-1", vtt: VTT,
    });
    const body = await response.json();
    expect(body.usage).toEqual({ usedSeconds: 126, limitSeconds: 7200 });
  });

  it("refuses past the monthly cap without touching the video", async () => {
    mocks.adminRpc.mockResolvedValue({ data: [{ usage_id: null, used_seconds: 7100, limit_seconds: 7200 }], error: null });
    const response = await post({ action: "transcribe", language: "en" });
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe("monthly_limit");
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });

  it("gives the hours back when the AI fails, and hides an empty balance from the teacher", async () => {
    mocks.transcribe.mockRejectedValue(new OpenAIError("no_credit", "openai_429"));
    const response = await post({ action: "transcribe", language: "en" });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("ai_unavailable");
    const refund = mocks.adminCalls.find((c) => c.table === "ai_usage");
    expect(refund?.ops).toEqual([["delete", []], ["eq", ["id", 7]]]);
  });

  it("refuses a video id copied from another course and a video still processing", async () => {
    mocks.asset.mockResolvedValueOnce({
      data: { course_id: "course-1", lesson_id: "l1", bunny_video_id: "vid-1", storage_path: "bunny/vid-1/forged" },
      error: null,
    });
    expect((await post({ action: "transcribe", language: "en" })).status).toBe(404);
    mocks.videoStatus.mockResolvedValueOnce({ status: 3, encodeProgress: 40, lengthSeconds: 125 });
    expect((await post({ action: "transcribe", language: "en" })).status).toBe(409);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("refuses videos longer than 2 hours before claiming", async () => {
    mocks.videoStatus.mockResolvedValue({ status: 4, encodeProgress: 100, lengthSeconds: 7201 });
    expect((await post({ action: "transcribe", language: "en" })).status).toBe(422);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });
});

describe("review and publish", () => {
  it("rejects captions with a broken timing line", async () => {
    const response = await post({ action: "saveCaption", language: "en", vtt: "WEBVTT\n\n00:00:05.000 --> 00:00:01.000\nHi" });
    expect(response.status).toBe(422);
  });

  it("publishes to Bunny only for the lesson's current video", async () => {
    mocks.adminResult.mockImplementation(({ table, ops }: { table: string; ops: [string, unknown[]][] }) =>
      table === "lesson_captions" && !ops.some(([op]) => op === "update")
        ? { data: row({ video_id: "old-video" }), error: null }
        : { data: row(), error: null });
    expect((await post({ action: "publishCaption", language: "en" })).status).toBe(409);
    expect(mocks.putCaption).not.toHaveBeenCalled();

    mocks.adminResult.mockImplementation(() => ({ data: row(), error: null }));
    expect((await post({ action: "publishCaption", language: "en" })).status).toBe(200);
    expect(mocks.putCaption).toHaveBeenCalledWith("vid-1", "en", "English", VTT);
  });

  it("translates only captions made for the lesson's current video, into a new draft", async () => {
    mocks.adminResult.mockImplementation(({ table, ops }: { table: string; ops: [string, unknown[]][] }) =>
      table === "lesson_captions" && !ops.some(([op]) => op === "upsert")
        ? { data: row({ video_id: "old-video" }), error: null }
        : { data: row({ language: "es" }), error: null });
    expect((await post({ action: "translate", from: "en", to: "es" })).status).toBe(409);
    expect(mocks.translate).not.toHaveBeenCalled();

    mocks.translate.mockResolvedValue("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHola\n");
    mocks.adminResult.mockImplementation(({ ops }: { ops: [string, unknown[]][] }) =>
      ({ data: row(ops.some(([op]) => op === "upsert") ? { language: "es" } : {}), error: null }));
    const response = await post({ action: "translate", from: "en", to: "es" });
    expect(response.status).toBe(200);
    expect(mocks.translate).toHaveBeenCalledWith(expect.objectContaining({ vtt: VTT, from: "en", to: "es" }));
    expect(mocks.rateLimit).toHaveBeenCalledWith("teach_ai_text_daily_owner-1", 40, 86_400_000);
  });

  it("lists captions, the quiz and this month's usage", async () => {
    mocks.adminRpc.mockResolvedValue({ data: [{ used_seconds: 600, limit_seconds: 36000 }], error: null });
    mocks.adminResult.mockImplementation(({ table }: { table: string }) =>
      table === "lesson_quizzes"
        ? { data: { questions: [quizQuestion], status: "draft", updated_at: "t" }, error: null }
        : { data: [row()], error: null });
    const response = await GET(new Request("https://example.test/api/teach/ai?courseId=course-1&lessonId=l1&assetId=asset-1"));
    const body = await response.json();
    expect(body.quiz).toEqual({ questions: [quizQuestion], status: "draft", updatedAt: "t" });
  });

  it("lists captions with this month's usage", async () => {
    mocks.adminRpc.mockResolvedValue({ data: [{ used_seconds: 600, limit_seconds: 36000 }], error: null });
    mocks.adminResult.mockImplementation(() => ({ data: [row({ video_id: "old-video" })], error: null }));
    const response = await GET(new Request("https://example.test/api/teach/ai?courseId=course-1&lessonId=l1&assetId=asset-1"));
    const body = await response.json();
    expect(body.usage).toEqual({ usedSeconds: 600, limitSeconds: 36000 });
    expect(body.captions[0]).toMatchObject({ language: "en", stale: true });
  });
});

describe("quiz and suggestions", () => {
  it("asks for captions first when the lesson has no transcript", async () => {
    const response = await post({ action: "generateQuiz" });
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("no_transcript");
    expect(mocks.generateQuiz).not.toHaveBeenCalled();
  });

  it("writes the quiz from the current video's captions and saves it as a draft", async () => {
    mocks.adminResult.mockImplementation(({ table, ops }: { table: string; ops: [string, unknown[]][] }) => {
      if (table === "lesson_quizzes") return { data: { questions: [quizQuestion], status: "draft", updated_at: "t" }, error: null };
      return { data: ops.some(([op]) => op === "order") ? [row()] : row(), error: null };
    });
    mocks.generateQuiz.mockResolvedValue([quizQuestion]);
    const response = await post({ action: "generateQuiz" });
    expect(response.status).toBe(200);
    expect(mocks.generateQuiz).toHaveBeenCalledWith("Hello", expect.anything());
    const upsert = mocks.adminCalls.find((c) => c.table === "lesson_quizzes")?.ops.find(([op]) => op === "upsert");
    expect(upsert?.[1][0]).toMatchObject({ lesson_id: "l1", owner_id: "owner-1", status: "draft", questions: [quizQuestion] });
  });

  it("refuses an edited quiz with no right answer, and publishes a valid one", async () => {
    expect((await post({ action: "saveQuiz", questions: [{ ...quizQuestion, answer: 5 }] })).status).toBe(422);
    mocks.adminResult.mockImplementation(() => ({ data: { questions: [quizQuestion], status: "published", updated_at: "t" }, error: null }));
    expect((await post({ action: "saveQuiz", questions: [quizQuestion], publish: true })).status).toBe(200);
    const upsert = mocks.adminCalls.find((c) => c.table === "lesson_quizzes")?.ops.find(([op]) => op === "upsert");
    expect(upsert?.[1][0]).toMatchObject({ status: "published" });
  });

  it("suggests module titles from that module's lessons and saves nothing", async () => {
    mocks.adminResult.mockImplementation(() => ({ data: [{ lesson_id: "l1", vtt: VTT }], error: null }));
    mocks.suggest.mockResolvedValue({ titles: ["Habits"], descriptions: [] });
    const response = await post({ action: "suggest", target: "module", moduleId: "m1" });
    expect(response.status).toBe(200);
    expect(mocks.suggest).toHaveBeenCalledWith("module", expect.stringContaining("Hello"), expect.anything());
    expect(mocks.adminCalls.some((c) => c.ops.some(([op]) => op === "upsert"))).toBe(false);
  });
});
