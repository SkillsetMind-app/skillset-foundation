import { afterEach, describe, expect, it, vi } from "vitest";

import { scrollBehavior } from "@/lib/ui/scroll-behavior";

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") && matches,
  }));
}

describe("scrollBehavior", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rola suave por padrao", () => {
    mockReducedMotion(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("pula a animacao quando a pessoa pede reduzir movimento", () => {
    mockReducedMotion(true);
    expect(scrollBehavior()).toBe("auto");
  });
});
