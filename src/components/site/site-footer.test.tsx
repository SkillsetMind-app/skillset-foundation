import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteFooter } from "@/components/site/site-footer";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// SiteFooter is an async server component: it resolves the language from the cookie.
// No cookie = English.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

// Storefront open (12 courses from 5 teachers)? Contract of isMarketplaceOpen;
// starts as yes.
const state = vi.hoisted(() => ({ hasCourses: true }));
vi.mock("@/lib/data/server/public-course", () => ({ isMarketplaceOpen: async () => state.hasCourses }));

afterEach(() => {
  cleanup();
  state.hasCourses = true;
});

describe("SiteFooter", () => {
  // A closed storefront gets no link: the footer leads to it only with 12 courses from
  // 5 teachers, the same rule as the menu and the home.
  it("removes Courses and Instructors from the footer while the storefront is closed", async () => {
    state.hasCourses = false;
    render(await SiteFooter());

    expect(screen.queryByRole("link", { name: "Courses" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/courses"]')).toBeNull();
    expect(screen.queryByRole("link", { name: "Instructors" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/instructors"]')).toBeNull();
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
  });

  it("lists Courses, Instructors and About, and /promise appears only once", async () => {
    render(await SiteFooter());

    // Three public pages that not even the top menu lists: the footer is the door.
    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute(
      "href",
      "/courses",
    );
    expect(screen.getByRole("link", { name: "Instructors" })).toHaveAttribute(
      "href",
      "/instructors",
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "/about",
    );

    // Before: "The Promise" and "Creator Promise" pointed to the SAME page.
    const promiseLinks = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/promise");
    expect(promiseLinks).toHaveLength(1);
    expect(screen.queryByText("Creator Promise")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Copyright (DMCA)" })).toHaveAttribute("href", "/legal/copyright");
  });

  it("says it is education, not therapy", async () => {
    render(await SiteFooter());
    expect(document.body.textContent).toContain("Education, not therapy.");
  });

  it("opens the language menu upward, so it does not fall off the page", async () => {
    render(await SiteFooter());
    fireEvent.click(screen.getByRole("button", { name: "Language: English" }));
    expect(screen.getByRole("listbox", { name: "Language" })).toHaveClass("bottom-full", "right-0");
  });

  it("has the new labels in both dictionaries", () => {
    const es = getDictionary("es");
    // translate() falls back to English when the key is missing; if the Spanish
    // label came out equal to the English one, the key would not be in es.json.
    expect(translate(es, "footer.courses")).toBe("Cursos");
    expect(translate(es, "footer.instructors")).toBe("Instructores");
    expect(translate(es, "footer.about")).not.toBe("About");
  });
});
