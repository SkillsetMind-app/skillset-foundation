import { afterEach, expect, it, vi } from "vitest";

import { getCourseAssetUploadErrorMessage } from "@/domain/course-asset";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: vi.fn() }));
import { uploadLessonVideoToBunny } from "./course-assets";

afterEach(() => vi.unstubAllGlobals());

const upload = () => uploadLessonVideoToBunny({
  courseId: "course-1", ownerId: "owner-1", kind: "lesson_video", lessonId: "lesson-1", isPreview: false,
  file: new File(["x"], "lesson.mp4", { type: "video/mp4" }),
});

const answer = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

// video/create answers 429 for two reasons: the hourly throttle on every plan,
// and the Free plan's daily cap. Only the second waits until tomorrow.
it("tells a Free-plan creator over the daily cap to come back tomorrow, in EN and ES, without a fee", async () => {
  answer(429, { error: "Daily upload limit without a plan. Try again tomorrow.", code: "free_plan_daily_limit" });
  const error = await upload().catch((caught: unknown) => caught);
  expect(error).toEqual(new Error("Daily upload limit without a plan. Try again tomorrow."));
  for (const locale of ["en", "es"] as const) {
    const message = getCourseAssetUploadErrorMessage(error, undefined, (key) => translate(getDictionary(locale), key));
    expect(message).toBe(locale === "en"
      ? "Daily upload limit without a plan. Try again tomorrow."
      : "Límite diario de subidas sin plan. Vuelve a intentarlo mañana.");
    expect(message).not.toMatch(/fee|tarifa|activ/i);
  }
});

it("keeps the hourly throttle as a wait-a-little message", async () => {
  answer(429, { error: "Too many attempts. Please wait before trying again." });
  await expect(upload()).rejects.toThrow("bunny-create-failed:429");
});
