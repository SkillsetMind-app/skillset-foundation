import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Home from "@/app/page";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

// SiteFooter is an async server component that reads the locale via
// next/headers — not renderable in this synchronous jsdom test, and not what
// this test asserts (the marketing hero copy). Stub it out.
vi.mock("@/components/site/site-footer", () => ({
  SiteFooter: () => null,
}));

afterEach(() => {
  cleanup();
});

describe("marketing home", () => {
  it("renders the product thesis", () => {
    render(<Home />);

    expect(
      screen.getByText("Your knowledge changes lives.", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Three steps from your method to a published program."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Six commitments. Written down. Public."),
    ).toBeInTheDocument();
  });

  it("lists the header in the order the sections appear", () => {
    render(<Home />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent?.trim()),
    ).toEqual([
      "How it works",
      "Courses",
      "The promise",
      "For creators",
      "Pricing",
    ]);
  });

  it("shows the promise as one charter, on every screen size", () => {
    render(<Home />);

    // Each clause appears exactly once: the 01/03/04 cards that repeated
    // three of them out of order are gone.
    expect(screen.getByText("Fee-lock for 24 months")).toBeInTheDocument();
    expect(
      screen.queryByText(/Export every course, student, sale, and post/),
    ).not.toBeInTheDocument();

    const card = screen
      .getByText("Public record · v1.0")
      .closest("div.relative.overflow-hidden");
    expect(card).not.toHaveClass("hidden");
    expect(
      screen.getByRole("link", { name: "Read the full Promise" }),
    ).toHaveAttribute("href", "/promise");
  });
});
