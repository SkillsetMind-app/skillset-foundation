import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CourseLandingBlocks } from "@/components/courses/course-landing-blocks";
import type { CourseLandingBlock } from "@/domain/course-landing";

afterEach(cleanup);

const blocks: CourseLandingBlock[] = [
  { kind: "hero", heading: "Stress Reset Program", subheading: "One line on who this is for.", imageUrl: null },
  { kind: "method", heading: "How I teach this", body: "Short daily practices." },
  { kind: "faq", heading: "Questions", items: [{ question: "How long does it take?", answer: "Ten minutes a day." }] },
  { kind: "cta", heading: "Ready to start?", body: "", buttonLabel: "Enrol now" },
];

// O bloco de abertura era um segundo h1 de até 60px, maior que o título da
// página; o botão era feito à mão e a pergunta usava o triângulo do navegador.
describe("CourseLandingBlocks: as peças do site, abaixo do título da página", () => {
  it.each(["classic", "bold"] as const)("no modelo %s, nenhum bloco abre um segundo h1 nem usa a serifa de destaque", (template) => {
    const { container } = render(<CourseLandingBlocks blocks={blocks} template={template} />);

    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual([
      "Stress Reset Program",
      "How I teach this",
      "Questions",
      "Ready to start?",
    ]);
    expect(container.querySelector("h2.display-title")).toBeNull();
  });

  it("o botão do bloco final é o botão da casa e segue levando à compra", () => {
    const onEnrol = vi.fn();
    render(<CourseLandingBlocks blocks={blocks} template="classic" onEnrol={onEnrol} />);

    const button = screen.getByRole("button", { name: "Enrol now" });
    expect(button).toHaveClass("button-solid", "button-lg");
    fireEvent.click(button);
    expect(onEnrol).toHaveBeenCalledTimes(1);
  });

  it("a pergunta abre e fecha como as de /pricing, com a seta no lugar do triângulo", () => {
    const { container } = render(<CourseLandingBlocks blocks={blocks} template="bold" />);

    const summary = screen.getByText("How long does it take?").closest("summary")!;
    expect(summary).toHaveClass("list-none");
    expect(summary.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("details")).toHaveClass("[&_summary::-webkit-details-marker]:hidden");
  });
});
