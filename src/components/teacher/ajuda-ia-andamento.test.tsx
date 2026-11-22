import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { AiSuggest } from "@/components/teacher/ai-suggest";
import { LessonAiCaptions } from "@/components/teacher/lesson-ai-captions";
import { LessonAiQuiz } from "@/components/teacher/lesson-ai-quiz";
import { callTeachAi, loadTeachAi, type TeachAiResult } from "@/lib/ai/teach-ai-client";

// As ajudas de IA nao mostravam que estavam trabalhando, o erro saia no cinza
// do sucesso e nao havia como tentar de novo (o quiz que nao carregava ficava
// sem nenhum botao). Agora: botao travado com "...", erro em alerta e "Try
// again" repetindo o MESMO pedido.

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

describe("ajudas de IA: andamento, erro e tentar de novo", () => {
  it("sugerir: trava o botao enquanto pede e o erro vem em alerta com Try again", async () => {
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

  it("quiz que nao carregou: Try again le de novo e os botoes voltam", async () => {
    vi.mocked(loadTeachAi).mockResolvedValueOnce(failed);
    mount(<LessonAiQuiz {...ids} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach the server.");
    expect(screen.queryByRole("button", { name: "Generate quiz" })).not.toBeInTheDocument();

    vi.mocked(loadTeachAi).mockResolvedValueOnce({ ok: true, status: 200, body: { quiz: null } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Generate quiz" })).toBeInTheDocument();
    expect(loadTeachAi).toHaveBeenCalledTimes(2);
  });

  it("legenda: um pedido que falhou e repetido igual pelo Try again", async () => {
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

  // Repetir um "salvar" antigo depois de editar gravaria o texto velho por cima.
  it("quiz: editar depois de um salvar que falhou tira o Try again do pedido antigo", async () => {
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
});
