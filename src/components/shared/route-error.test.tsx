// O erro de uma área devolve a pessoa ao início da PRÓPRIA área, não ao site
// público, e os dois botões precisam funcionar mesmo em /teach e /learn.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LearnError from "@/app/learn/error";
import TeachError from "@/app/teach/error";

const mocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/posthog/client", () => ({ captureException: mocks.capture }));

afterEach(() => {
  cleanup();
  mocks.capture.mockReset();
});

const boundaries = [
  ["estúdio do professor", TeachError, "/teach", "teach"],
  ["área do aluno", LearnError, "/learn", "learn"],
] as const;

describe("erro dentro de uma área", () => {
  it.each(boundaries)("%s: registra o erro com a área e mostra o cartão", (_name, Boundary, _home, boundary) => {
    const error = Object.assign(new Error("boom"), { digest: "d1" });
    render(<Boundary error={error} reset={vi.fn()} retry={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "This page hit an unexpected error." })).toBeInTheDocument();
    expect(mocks.capture).toHaveBeenCalledWith(error, { boundary, digest: "d1" });
  });

  // `reset` só redesenha com o mesmo resultado do servidor: o erro voltaria
  // igual. O botão tem de buscar os dados de novo (`retry`).
  it.each(boundaries)("%s: 'Try again' busca os dados de novo", (_name, Boundary) => {
    const reset = vi.fn();
    const retry = vi.fn();
    render(<Boundary error={new Error("boom")} reset={reset} retry={retry} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("sem `retry` (versão antiga do Next) 'Try again' ainda limpa o erro", () => {
    const reset = vi.fn();
    render(<TeachError error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  // A fronteira de erro só se desfaz quando o endereço muda. Um <Link> para a
  // própria página não mudaria nada: o link é um <a> comum, com recarga.
  it.each(boundaries)("%s: 'Go home' é um link comum para o início da área", (_name, Boundary, home) => {
    render(<Boundary error={new Error("boom")} reset={vi.fn()} retry={vi.fn()} />);

    const link = screen.getByRole("link", { name: "Go home" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", home);
  });
});
