import { render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DrawnCheck, MilestoneSeal, useJustDone } from "@/components/ui/drawn-check";

// "1 festa por marco": o check e o selo so se mexem na MUDANCA. Abrir a tela
// com tudo pronto, ou uma leitura que chega atrasada, nao conta.
describe("useJustDone", () => {
  it("o que ja estava feito na primeira leitura nao conta", () => {
    const { result } = renderHook(({ done }) => useJustDone(done), {
      initialProps: { done: ["a", "b"] },
    });
    expect([...result.current]).toEqual([]);
  });

  it("o que fica feito depois conta; desfazer e refazer conta de novo", () => {
    const { result, rerender } = renderHook(({ done }) => useJustDone(done), {
      initialProps: { done: ["a"] },
    });
    rerender({ done: ["a", "b"] });
    expect([...result.current]).toEqual(["b"]);

    rerender({ done: ["b"] });
    rerender({ done: ["a", "b"] });
    expect([...result.current].sort()).toEqual(["a", "b"]);
  });

  it("antes de `ready` nada conta, e a linha de base sai da primeira leitura pronta", () => {
    const { result, rerender } = renderHook(({ done, ready }) => useJustDone(done, ready), {
      initialProps: { done: [] as string[], ready: false },
    });
    // Os valores falsos iniciais viram verdade junto com a leitura: nao e festa.
    rerender({ done: ["payouts"], ready: true });
    expect([...result.current]).toEqual([]);
    rerender({ done: ["payouts", "price"], ready: true });
    expect([...result.current]).toEqual(["price"]);
  });
});

describe("DrawnCheck e MilestoneSeal", () => {
  it("so levam a classe que anima com `animate`; sem ela nascem inteiros", () => {
    const { container, rerender } = render(<DrawnCheck />);
    const check = container.querySelector("svg")!;
    expect(check).toHaveAttribute("aria-hidden", "true");
    expect(check).not.toHaveClass("drawn-check");
    rerender(<DrawnCheck animate />);
    expect(container.querySelector("svg")).toHaveClass("drawn-check");

    const seal = render(<MilestoneSeal />).container.querySelector("[data-milestone-seal]")!;
    expect(seal).not.toHaveClass("milestone-seal");
    expect(render(<MilestoneSeal animate />).container.querySelector("[data-milestone-seal]")).toHaveClass("milestone-seal");
  });
});
