import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RevealSection } from "@/components/shared/reveal-section";

// A entrada da seção é enfeite: o que nasce visível (sem JavaScript, antes da
// hidratação ou já na tela) continua visível. Só o que está abaixo da tela é
// armado e entra quando o topo chega a 90% da altura da tela.
type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;

function mountAt(top: number) {
  const observers: Array<{ callback: Callback; options: IntersectionObserverInit }> = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: Callback, options: IntersectionObserverInit) {
        observers.push({ callback, options });
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top } as DOMRect);
  render(<RevealSection data-testid="section">conteudo</RevealSection>);
  return { section: screen.getByTestId("section"), observers };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RevealSection", () => {
  it("sem IntersectionObserver a seção nunca é armada, mesmo abaixo da tela", () => {
    expect(window.IntersectionObserver).toBeUndefined();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight + 400 } as DOMRect);
    render(<RevealSection data-testid="section">conteudo</RevealSection>);
    expect(screen.getByTestId("section").className).not.toContain("reveal-on-view--armed");
  });

  it("já na tela ao montar: fica como está, sem esconder", () => {
    const { section, observers } = mountAt(window.innerHeight - 1);
    expect(section.className).not.toContain("reveal-on-view--armed");
    expect(observers).toHaveLength(0);
  });

  it("abaixo da tela: armada, e entra quando o topo passa dos 90% da tela", () => {
    const { section, observers } = mountAt(window.innerHeight + 400);
    expect(section.className).toContain("reveal-on-view--armed");
    expect(section.className).not.toContain("reveal-on-view--in");
    expect(observers.at(-1)?.options).toEqual({ rootMargin: "0px 0px -10% 0px", threshold: 0 });

    act(() => observers.at(-1)!.callback([{ isIntersecting: true }]));
    expect(section.className).toContain("reveal-on-view--in");
  });
});
