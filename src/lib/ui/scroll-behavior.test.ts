import { afterEach, describe, expect, it, vi } from "vitest";

import { scrollBehavior } from "@/lib/ui/scroll-behavior";

function mockReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") && matches,
  }));
}

describe("scrollBehavior", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("scrolls smoothly by default", () => {
    mockReducedMotion(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("skips the animation when the person asks for reduced motion", () => {
    mockReducedMotion(true);
    expect(scrollBehavior()).toBe("auto");
  });
});
