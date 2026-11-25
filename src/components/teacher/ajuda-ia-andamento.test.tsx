import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { AiSuggest } from "@/components/teacher/ai-suggest";
import { LessonAiCaptions } from "@/components/teacher/lesson-ai-captions";
import { LessonAiQuiz } from "@/components/teacher/lesson-ai-quiz";
import { callTeachAi, loadTeachAi, type TeachAiResult } from "@/lib/ai/teach-ai-client";

// The AI helpers did not show that they were working, the error came out in the success
// gray and there was no way to try again (the quiz that failed to load was left
// without any button). Now: button locked with "...", error as an alert and "Try
// again" repeating the SAME request.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/teach/builder",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/ai/teach-ai-client", () => ({
  callTeachAi: vi.fn(),
  loadTeachAi: vi.fn(),
  teachAiErrorText: () => "We couldn't reach the server. Please try again.",
}));

const ids = { courseId: "course-1", lessonId: "lesson-1", assetId: "asset-1" };
const failed: TeachAiResult = { ok: false, status: 503, body: {} };
const mount = (ui: ReactElement) => render(<I18nProvider initialLocale="en">{ui}</I18nProvider>);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("AI helpers: progress, error and try again", () => {
  it("suggest: locks the button while requesting and the error comes as an alert with Try again", async () => {
    let finish!: (result: TeachAiResult) => void;
    vi.mocked(callTeachAi).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    mount(<AiSuggest {...ids} target="lesson" onUseTitle={vi.fn()} onUseDescription={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));
    const busy = screen.getByRole("button", { name: "Suggesting..." });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");

    finish(failed);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach the server.");
    expect(screen.getByRole("status")).toHaveTextContent("");

    vi.mocked(callTeachAi).mockResolvedValueOnce({ ok: true, status: 200, body: { suggestions: { titles: ["A title"], descriptions: [] } } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("A title")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(callTeachAi).toHaveBeenCalledTimes(2);
    expect(vi.mocked(callTeachAi).mock.calls[1]).toEqual(vi.mocked(callTeachAi).mock.calls[0]);
  });

  it("quiz that failed to load: Try again reads it again and the buttons come back", async () => {
    vi.mocked(loadTeachAi).mockResolvedValueOnce(failed);
    mount(<LessonAiQuiz {...ids} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach the server.");
    expect(screen.queryByRole("button", { name: "Generate quiz" })).not.toBeInTheDocument();

    vi.mocked(loadTeachAi).mockResolvedValueOnce({ ok: true, status: 200, body: { quiz: null } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Generate quiz" })).toBeInTheDocument();
    expect(loadTeachAi).toHaveBeenCalledTimes(2);
  });

  it("captions: a failed request is repeated identically by Try again", async () => {
    vi.mocked(loadTeachAi).mockResolvedValue({
      ok: true,
      status: 200,
      body: { captions: [], usage: { usedSeconds: 0, limitSeconds: 3600 } },
    });
    vi.mocked(callTeachAi).mockResolvedValueOnce(failed);
    mount(<LessonAiCaptions {...ids} />);

    fireEvent.click(await screen.findByRole("button", { name: "Generate captions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach the server.");

    vi.mocked(callTeachAi).mockResolvedValueOnce({ ok: true, status: 200, body: {} });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(callTeachAi).toHaveBeenCalledTimes(2));
    expect(vi.mocked(callTeachAi).mock.calls[1]).toEqual(vi.mocked(callTeachAi).mock.calls[0]);
    expect(await screen.findByRole("status")).toHaveTextContent("Draft ready. Review it, then publish.");
  });

  // Repeating an old "save" after an edit would write the old text over the new one.
  it("quiz: editing after a failed save removes Try again for the old request", async () => {
    vi.mocked(loadTeachAi).mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { quiz: { status: "draft", questions: [{ question: "Q?", options: ["a", "b", "c", "d"], answer: 0, explanation: "" }] } },
    });
    vi.mocked(callTeachAi).mockResolvedValueOnce(failed);
    mount(<LessonAiQuiz {...ids} />);
    const question = await screen.findByLabelText("Question");
    fireEvent.change(question, { target: { value: "Q, edited?" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    fireEvent.change(question, { target: { value: "Q, edited again?" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  // Changing the language after the failure: "Try again" would redo the request in the old
  // language (and spend AI hours on it). Applies to both selectors.
  it("captions: changing the spoken or target language removes Try again for the old request", async () => {
    vi.mocked(loadTeachAi).mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        captions: [{ language: "en", vtt: "WEBVTT", translatedFrom: null, updatedAt: "2026-11-01", publishedAt: null, stale: false }],
        usage: { usedSeconds: 0, limitSeconds: 3600 },
      },
    });
    vi.mocked(callTeachAi).mockResolvedValue(failed);
    mount(<LessonAiCaptions {...ids} />);
    const translateTo = await screen.findByLabelText("Translate the English captions to");

    for (const change of [
      () => fireEvent.change(screen.getByLabelText("Language spoken in the video"), { target: { value: "pt" } }),
      () => fireEvent.change(translateTo, { target: { value: "fr" } }),
    ]) {
      fireEvent.change(translateTo, { target: { value: "es" } });
      fireEvent.click(screen.getByRole("button", { name: "Translate" }));
      expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
      change();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    }
  });

  // Publishing with edited text saves and then publishes: the "Try again" of a
  // failed save redoes both steps, not just the first.
  it("captions: Try again after a Publish that failed to save redoes save and publish", async () => {
    vi.mocked(loadTeachAi).mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: {
        captions: [{ language: "en", vtt: "WEBVTT", translatedFrom: null, updatedAt: "2026-11-01", publishedAt: null, stale: false }],
        usage: { usedSeconds: 0, limitSeconds: 3600 },
      },
    });
    mount(<LessonAiCaptions {...ids} />);
    fireEvent.change(await screen.findByLabelText("Captions in English"), { target: { value: "WEBVTT\n\nedited" } });
    vi.mocked(callTeachAi).mockResolvedValueOnce(failed);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    vi.mocked(callTeachAi).mockResolvedValue({ ok: true, status: 200, body: {} });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Published. Students see these captions in the player.")).toBeInTheDocument();
    expect(vi.mocked(callTeachAi).mock.calls.map(([payload]) => payload.action)).toEqual([
      "saveCaption",
      "saveCaption",
      "publishCaption",
    ]);
  });
});
