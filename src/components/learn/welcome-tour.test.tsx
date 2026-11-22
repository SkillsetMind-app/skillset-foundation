import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WelcomeTour } from "@/components/learn/welcome-tour";

const mocks = vi.hoisted(() => ({ dismiss: vi.fn() }));

// Quem decide se o tour abre (e grava que já foi visto) é o hook; aqui só a
// janela. A regra do "visto" não muda neste arquivo.
vi.mock("@/lib/ui/use-welcome-tour", () => ({
  useWelcomeTour: () => ({ open: true, dismiss: mocks.dismiss }),
}));

describe("WelcomeTour do aluno", () => {
  beforeEach(() => {
    mocks.dismiss.mockReset();
  });

  it("um controle de pular só; Skip fecha", () => {
    render(<WelcomeTour userId="u-1" firstName="Ana" />);

    expect(screen.getAllByRole("button", { name: /skip/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
  });

  // Antes o texto trocava e a janela crescia ou encolhia a cada passo, e os
  // botões saíam de baixo do mouse. Agora os quatro passos ocupam a mesma
  // célula (a altura é a do mais longo) e só o atual é lido.
  it("todos os passos reservam a altura; só o atual aparece, e o foco vai para o título dele", () => {
    render(<WelcomeTour userId="u-1" firstName="Ana" />);

    expect(screen.getByText("Manage your account")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Welcome, Ana" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const second = screen.getByRole("heading", { level: 2, name: "Pick up where you left off" });
    expect(second).toHaveFocus();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Pick up where you left off" })).toBeInTheDocument();

    // Voltar ao 1º passo tira o "Back" da tela: o foco não fica perdido nele.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Welcome, Ana" })).toHaveFocus();
  });
});
