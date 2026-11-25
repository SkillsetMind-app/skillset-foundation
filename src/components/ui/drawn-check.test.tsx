import { render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DrawnCheck, MilestoneSeal, useJustDone } from "@/components/ui/drawn-check";

// "1 celebration per milestone": the check and the seal only move on the CHANGE. Opening the screen
// with everything done, or a read that arrives late, does not count.
describe("useJustDone", () => {
  it("what was already done on the first read does not count", () => {
    const { result } = renderHook(({ done }) => useJustDone(done), {
      initialProps: { done: ["a", "b"] },
    });
    expect([...result.current]).toEqual([]);
  });

  it("what becomes done afterward counts; undoing and redoing counts again", () => {
    const { result, rerender } = renderHook(({ done }) => useJustDone(done), {
      initialProps: { done: ["a"] },
    });
    rerender({ done: ["a", "b"] });
    expect([...result.current]).toEqual(["b"]);

    rerender({ done: ["b"] });
    rerender({ done: ["a", "b"] });
    expect([...result.current].sort()).toEqual(["a", "b"]);
  });

  it("before `ready` nothing counts, and the baseline comes from the first ready read", () => {
    const { result, rerender } = renderHook(({ done, ready }) => useJustDone(done, ready), {
      initialProps: { done: [] as string[], ready: false },
    });
    // The initial false values become true together with the read: not a celebration.
    rerender({ done: ["payouts"], ready: true });
    expect([...result.current]).toEqual([]);
    rerender({ done: ["payouts", "price"], ready: true });
    expect([...result.current]).toEqual(["price"]);
  });
});

describe("DrawnCheck and MilestoneSeal", () => {
  it("only carry the animating class with `animate`; without it they are born whole", () => {
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
