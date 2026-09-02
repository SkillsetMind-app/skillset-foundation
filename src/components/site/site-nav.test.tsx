import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteNav } from "@/components/site/site-nav";

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
});

const HEADER_ORDER = ["Courses", "For creators", "Pricing", "Promise", "Help"];

function linkNames(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.textContent?.trim() ?? "");
}

describe("SiteNav", () => {
  it("leads with Courses, the door for people who come to learn", () => {
    render(<SiteNav />);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(linkNames(nav)).toEqual(HEADER_ORDER);
    expect(within(nav).getByRole("link", { name: "Courses" })).toHaveAttribute(
      "href",
      "/courses",
    );
  });

  it("makes Sign in a plain link instead of a learner/teacher menu", () => {
    render(<SiteNav />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/auth?mode=signin",
    );
    expect(
      screen.queryByRole("button", { name: /sign in/i }),
    ).not.toBeInTheDocument();
  });

  it("offers the language switch in the header", () => {
    render(<SiteNav />);

    const group = screen.getByRole("group", { name: "Language" });
    expect(
      within(group).getByRole("button", { name: "English" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(group).getByRole("button", { name: "Español" }),
    ).toBeInTheDocument();
  });

  it("keeps the mobile menu in the same order and closes on Escape", () => {
    render(<SiteNav />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const mobile = screen.getByRole("navigation", {
      name: "Mobile navigation",
    });
    expect(linkNames(mobile)).toEqual(HEADER_ORDER);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
  });
});
