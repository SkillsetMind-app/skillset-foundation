import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WelcomeTour } from "@/components/learn/welcome-tour";
import { TeacherWelcomeTour } from "@/components/teacher/teacher-welcome-tour";

// P-24: o tour cobre a tela inteira no primeiro login e oferece duas saídas
// explícitas — o X (16px de ícone + 4px de padding = 24px) e o "Skip" (texto
// sem padding, 20px de altura). Menos da metade do alvo mínimo de 44px que a
// própria casa fixa em .button-solid/.button-outline, dentro do mesmo modal.
// jsdom não mede layout, então o que dá para morder é a classe de tamanho.
describe("saídas do tour de boas-vindas", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("no tour do professor, X e Skip têm alvo de 44px", () => {
    render(<TeacherWelcomeTour userId="teacher-1" firstName="Ana" />);

    expect(screen.getByRole("button", { name: "Skip the tour" })).toHaveClass("h-11", "w-11");
    expect(screen.getByRole("button", { name: "Skip" })).toHaveClass("min-h-11");
  });

  it("no tour do aluno, X e Skip têm alvo de 44px", () => {
    render(<WelcomeTour userId="student-1" firstName="Ana" />);

    // Ordem no DOM: o X no cabeçalho, depois o Skip no rodapé, antes de Next.
    const [close, skip] = within(screen.getByRole("dialog")).getAllByRole("button");
    expect(close).toHaveAttribute("aria-label");
    expect(close).toHaveClass("h-11", "w-11");
    expect(skip).toHaveClass("min-h-11");
  });
});
