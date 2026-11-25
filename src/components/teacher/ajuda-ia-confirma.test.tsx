import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { AiSuggest } from "@/components/teacher/ai-suggest";
import { clickConfirm, stubDialogs } from "@/components/teacher/confirm-test-helpers";
import { LessonAiCaptions } from "@/components/teacher/lesson-ai-captions";
import { LessonAiQuiz } from "@/components/teacher/lesson-ai-quiz";
import { callTeachAi, loadTeachAi } from "@/lib/ai/teach-ai-client";

// The AI helpers asked through window.confirm before replacing or removing
// what the teacher already had. Now they ask in the platform dialog, with the
// same sentence, and only confirming calls the AI (once).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/teach/builder",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/ai/teach-ai-client", () => ({
  callTeachAi: vi.fn(),
  loadTeachAi: vi.fn(),
  teachAiErrorText: () => "error",
}));

const ids = { courseId: "course-1", lessonId: "lesson-1", assetId: "asset-1" };

function mount(ui: ReactElement) {
  return render(<I18nProvider initialLocale="en">{ui}</I18nProvider>);
}

let restoreDialogs = () => {};
beforeEach(() => {
  vi.clearAllMocks();
  restoreDialogs = stubDialogs();
});
afterEach(() => {
  cleanup();
  restoreDialogs();
});

describe("AI helpers: confirm in the platform dialog", () => {
  it("using the suggested description over the current one asks first and applies once", async () => {
    vi.mocked(callTeachAi).mockResolvedValue({
      ok: true,
      status: 200,
      body: { suggestions: { titles: [], descriptions: ["A new description"] } },
    });
    const onUseDescription = vi.fn();
    mount(
      <AiSuggest {...ids} target="lesson" currentDescription="What I wrote" onUseTitle={vi.fn()} onUseDescription={onUseDescription} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use" }));

    const dialog = screen.getByRole("dialog", { name: "Replace the description?" });
    expect(dialog).toHaveAccessibleDescription("Replace the current description with this one?");
    expect(onUseDescription).not.toHaveBeenCalled();
    clickConfirm(dialog, "Replace description");
    expect(onUseDescription).toHaveBeenCalledExactlyOnceWith("A new description");
  });

  it("removing the quiz asks first and calls the AI only once, on confirm", async () => {
    vi.mocked(loadTeachAi).mockResolvedValue({
      ok: true,
      status: 200,
      body: { quiz: { status: "draft", questions: [{ question: "Q?", options: ["a", "b", "c", "d"], answer: 0, explanation: "" }] } },
    });
    vi.mocked(callTeachAi).mockResolvedValue({ ok: true, status: 200, body: { quiz: null } });
    mount(<LessonAiQuiz {...ids} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove quiz" }));
    const dialog = screen.getByRole("dialog", { name: "Remove this quiz?" });
    expect(dialog).toHaveAccessibleDescription("Remove this quiz? Students stop seeing it.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(callTeachAi).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove quiz" }));
    clickConfirm(screen.getByRole("dialog", { name: "Remove this quiz?" }), "Remove quiz");
    await waitFor(() => expect(callTeachAi).toHaveBeenCalledOnce());
    expect(callTeachAi).toHaveBeenCalledWith(expect.objectContaining({ action: "removeQuiz" }));
  });

  // The two paths that spend: generating again counts the AI hours again.
  it("generating the captions again sends nothing before confirming and sends once after", async () => {
    vi.mocked(loadTeachAi).mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        captions: [{ language: "en", vtt: "WEBVTT", translatedFrom: null, updatedAt: "2026-11-01", publishedAt: null, stale: false }],
        usage: { usedSeconds: 0, limitSeconds: 3600 },
      },
    });
    vi.mocked(callTeachAi).mockResolvedValue({ ok: true, status: 200, body: {} });
    mount(<LessonAiCaptions {...ids} />);

    fireEvent.click(await screen.findByRole("button", { name: "Generate again" }));
    const dialog = screen.getByRole("dialog", { name: "Generate the captions again?" });
    expect(dialog).toHaveAccessibleDescription(
      "Generate the captions again? Your edits in this language are replaced, and the video's length counts again toward your monthly AI hours.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(callTeachAi).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Generate again" }));
    clickConfirm(screen.getByRole("dialog", { name: "Generate the captions again?" }), "Generate again");
    await waitFor(() => expect(callTeachAi).toHaveBeenCalledOnce());
    expect(callTeachAi).toHaveBeenCalledWith(expect.objectContaining({ action: "transcribe", language: "en" }));
  });

  it("writing a new quiz over the existing one sends nothing before confirming and sends once after", async () => {
    vi.mocked(loadTeachAi).mockResolvedValue({
      ok: true,
      status: 200,
      body: { quiz: { status: "published", questions: [{ question: "Q?", options: ["a", "b", "c", "d"], answer: 0, explanation: "" }] } },
    });
    vi.mocked(callTeachAi).mockResolvedValue({ ok: true, status: 200, body: { quiz: null } });
    mount(<LessonAiQuiz {...ids} />);

    fireEvent.click(await screen.findByRole("button", { name: "Write new questions" }));
    const dialog = screen.getByRole("dialog", { name: "Write new questions?" });
    expect(dialog).toHaveAccessibleDescription(
      "Write new questions? Your current quiz is replaced and hidden from students until you publish again.",
    );
    expect(callTeachAi).not.toHaveBeenCalled();
    clickConfirm(dialog, "Write new questions");
    await waitFor(() => expect(callTeachAi).toHaveBeenCalledOnce());
    expect(callTeachAi).toHaveBeenCalledWith(expect.objectContaining({ action: "generateQuiz" }));
  });

  it("removing the caption asks first and calls the AI only once, on confirm", async () => {
    vi.mocked(loadTeachAi).mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        captions: [{ language: "en", vtt: "WEBVTT", translatedFrom: null, updatedAt: "2026-11-01", publishedAt: null, stale: false }],
        usage: { usedSeconds: 0, limitSeconds: 3600 },
      },
    });
    vi.mocked(callTeachAi).mockResolvedValue({ ok: true, status: 200, body: { removed: "en" } });
    mount(<LessonAiCaptions {...ids} />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog", { name: "Remove these captions?" });
    expect(dialog).toHaveAccessibleDescription("Remove these captions? If they are published, students stop seeing them.");
    expect(callTeachAi).not.toHaveBeenCalled();
    clickConfirm(dialog, "Remove");
    await waitFor(() => expect(callTeachAi).toHaveBeenCalledOnce());
    expect(callTeachAi).toHaveBeenCalledWith(expect.objectContaining({ action: "removeCaption", language: "en" }));
  });

  // Bunny already had a caption in this language, made outside the tool: publishing
  // replaces it. It asks first; cancelling sends nothing and shows no error.
  it("publishing over the caption already on the video asks first and only replaces on confirm", async () => {
    vi.mocked(loadTeachAi).mockResolvedValue({
      ok: true,
      status: 200,
      body: {
        captions: [{ language: "en", vtt: "WEBVTT", translatedFrom: null, updatedAt: "2026-11-01", publishedAt: null, stale: false }],
        usage: { usedSeconds: 0, limitSeconds: 3600 },
      },
    });
    const exists = { ok: false, status: 409, body: { code: "caption_exists" } };
    vi.mocked(callTeachAi).mockResolvedValueOnce(exists);
    mount(<LessonAiCaptions {...ids} />);

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    const title = "Replace the captions already on this video?";
    const dialog = await screen.findByRole("dialog", { name: title });
    expect(dialog).toHaveAccessibleDescription(
      "This video already has English captions. Publishing will replace them for your students.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(callTeachAi).toHaveBeenCalledOnce();

    vi.mocked(callTeachAi).mockResolvedValueOnce(exists).mockResolvedValueOnce({ ok: true, status: 200, body: {} });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    clickConfirm(await screen.findByRole("dialog", { name: title }), "Replace captions");
    await waitFor(() => expect(callTeachAi).toHaveBeenCalledTimes(3));
    expect(vi.mocked(callTeachAi).mock.calls.map(([payload]) => payload.replace)).toEqual([undefined, undefined, true]);
    expect(vi.mocked(callTeachAi).mock.calls[2][0]).toMatchObject({ action: "publishCaption", language: "en", replace: true });
  });
});
