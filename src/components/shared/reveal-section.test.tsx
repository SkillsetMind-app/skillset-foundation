import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RevealSection } from "@/components/shared/reveal-section";

// The section's entrance is decoration: what is born visible (without JavaScript, before
// hydration or already on screen) stays visible. Only what is below the screen is
// armed and enters when the top reaches 90% of the screen height.
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
  it("without IntersectionObserver the section is never armed, even below the screen", () => {
    expect(window.IntersectionObserver).toBeUndefined();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight + 400 } as DOMRect);
    render(<RevealSection data-testid="section">conteudo</RevealSection>);
    expect(screen.getByTestId("section").className).not.toContain("reveal-on-view--armed");
  });

  it("already on screen on mount: stays as it is, without hiding", () => {
    const { section, observers } = mountAt(window.innerHeight - 1);
    expect(section.className).not.toContain("reveal-on-view--armed");
    expect(observers).toHaveLength(0);
  });

  it("below the screen: armed, and enters when the top passes 90% of the screen", () => {
    const { section, observers } = mountAt(window.innerHeight + 400);
    expect(section.className).toContain("reveal-on-view--armed");
    expect(section.className).not.toContain("reveal-on-view--in");
    expect(observers.at(-1)?.options).toEqual({ rootMargin: "0px 0px -10% 0px", threshold: 0 });

    act(() => observers.at(-1)!.callback([{ isIntersecting: true }]));
    expect(section.className).toContain("reveal-on-view--in");
  });
});
