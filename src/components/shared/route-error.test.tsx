// O erro de uma área devolve a pessoa ao início da PRÓPRIA área, não ao site
// público.
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

describe("erro dentro de uma área", () => {
  it.each([
    ["estúdio do professor", TeachError, "/teach", "teach"],
    ["área do aluno", LearnError, "/learn", "learn"],
  ] as const)("%s: 'Go home' volta ao início da área e 'Try again' tenta de novo", (_name, Boundary, home, boundary) => {
    const reset = vi.fn();
    const error = Object.assign(new Error("boom"), { digest: "d1" });
    render(<Boundary error={error} reset={reset} />);

    expect(screen.getByRole("heading", { level: 1, name: "This page hit an unexpected error." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", home);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith(error, { boundary, digest: "d1" });
  });
});
