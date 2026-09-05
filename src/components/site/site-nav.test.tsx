import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import postcss from "postcss";

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
  it("keeps every entry action reachable before the full header fits at 1280px", () => {
    render(<SiteNav />);
    expect(screen.getByRole("button", { name: "Open menu" }).className).toContain("xl:hidden");
    const css = postcss.parse(readFileSync("src/app/globals.css", "utf8"));
    const hiddenLinks: string[] = [];
    css.walkAtRules("media", (rule) => {
      if (rule.params !== "(width < 1280px)") return;
      rule.walkRules(".site-header__links", (links) => {
        links.walkDecls("display", (decl) => { hiddenLinks.push(decl.value); });
      });
    });
    expect(hiddenLinks).toContain("none");
  });

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
