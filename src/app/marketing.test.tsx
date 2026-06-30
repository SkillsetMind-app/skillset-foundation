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
