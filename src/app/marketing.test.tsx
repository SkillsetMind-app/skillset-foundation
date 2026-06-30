import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
