// An area's error returns the person to the start of their OWN area, not to the public
// site, and both buttons must work even on /teach and /learn.
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

describe("error inside an area", () => {
  it.each(boundaries)("%s: logs the error with the area and shows the card", (_name, Boundary, _home, boundary) => {
    const error = Object.assign(new Error("boom"), { digest: "d1" });
    render(<Boundary error={error} reset={vi.fn()} retry={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "This page hit an unexpected error." })).toBeInTheDocument();
    expect(mocks.capture).toHaveBeenCalledWith(error, { boundary, digest: "d1" });
  });

  // `reset` only redraws with the same server result: the error would come back
  // the same. The button has to fetch the data again (`retry`).
  it.each(boundaries)("%s: 'Try again' fetches the data again", (_name, Boundary) => {
    const reset = vi.fn();
    const retry = vi.fn();
    render(<Boundary error={new Error("boom")} reset={reset} retry={retry} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it("without `retry` (old Next version) 'Try again' still clears the error", () => {
    const reset = vi.fn();
    render(<TeachError error={new Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  // The error boundary only resets when the address changes. A <Link> to the
  // page itself would change nothing: the link is a plain <a>, with a reload.
  it.each(boundaries)("%s: 'Go home' is a plain link to the start of the area", (_name, Boundary, home) => {
    render(<Boundary error={new Error("boom")} reset={vi.fn()} retry={vi.fn()} />);

    const link = screen.getByRole("link", { name: "Go home" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", home);
  });
});
