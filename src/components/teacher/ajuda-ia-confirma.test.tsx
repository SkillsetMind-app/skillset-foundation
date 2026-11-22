import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { AiSuggest } from "@/components/teacher/ai-suggest";
import { clickConfirm, stubDialogs } from "@/components/teacher/confirm-test-helpers";
import { LessonAiCaptions } from "@/components/teacher/lesson-ai-captions";
import { LessonAiQuiz } from "@/components/teacher/lesson-ai-quiz";
import { callTeachAi, loadTeachAi } from "@/lib/ai/teach-ai-client";

// As ajudas de IA perguntavam no window.confirm antes de substituir ou tirar
// o que o professor ja tinha. Agora perguntam na janela da plataforma, com a
// mesma frase, e so o confirmar chama a IA (uma vez).

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

describe("ajudas de IA: confirmar na janela da plataforma", () => {
  it("usar a descricao sugerida por cima da atual pergunta antes e aplica uma vez", async () => {
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

  it("tirar o quiz pergunta antes e chama a IA uma vez so no confirmar", async () => {
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

  it("tirar a legenda pergunta antes e chama a IA uma vez so no confirmar", async () => {
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
});
