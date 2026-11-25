import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import postcss from "postcss";

import { RealCoursesProvider } from "@/components/site/real-courses";
import { SiteNav } from "@/components/site/site-nav";
import type { SkillsetUser } from "@/domain/auth";

const auth = vi.hoisted(() => ({ user: null as SkillsetUser | null }));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: () => () => {},
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: auth.user ? "authenticated" : "unauthenticated",
    user: auth.user,
    signOut: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  auth.user = null;
  vi.unstubAllGlobals();
});

const HEADER_ORDER = ["Courses", "For creators", "Pricing", "Promise", "Help"];

function linkNames(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole("link")
    .map((link) => link.textContent?.trim() ?? "");
}

describe("SiteNav", () => {
  // Whoever navigates by keyboard or screen reader skips the whole bar: the
  // first focusable element leads to the <main id="conteudo"> of the page.
  it("the first focusable element is the skip to content link, hidden until focused", () => {
    const { container } = render(<SiteNav />);
    const focusable = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    expect(focusable[0]).toHaveTextContent("Skip to content");
    expect(focusable[0]).toHaveAttribute("href", "#conteudo");
    expect(focusable[0]).toHaveClass("sr-only", "focus:not-sr-only");
  });

  it("reserves the phone header for the brand mark, language, account and menu", () => {
    auth.user = { uid: "u-1", email: "person@example.com", displayName: "Test Person", roles: ["teacher"] } as SkillsetUser;
    render(<SiteNav />);

    // A display utility on the CTA itself loses to its unlayered CSS.
    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboard.parentElement).toHaveClass("hidden", "lg:block");
    const compactBrand = document.querySelector(".logo-wordmark__mark");
    expect(compactBrand?.closest("a")?.parentElement).toHaveClass("md:hidden");
    // The brand link is a touch target: the brand measures 40 (mark) or 32 (wordmark),
    // and the link inherited that — below 44px on phones and tablets (QA 07/09).
    expect(compactBrand?.closest("a")).toHaveClass("min-h-11", "min-w-11");
    expect(document.querySelector(".logo-wordmark__full")?.closest("a")?.parentElement).toHaveClass("hidden", "md:block");

    expect(screen.getByRole("button", { name: "Language: English" })).toHaveAttribute("aria-haspopup", "listbox");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute("href", "/teach");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

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
    render(<RealCoursesProvider value><SiteNav /></RealCoursesProvider>);

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(linkNames(nav)).toEqual(HEADER_ORDER);
    expect(within(nav).getByRole("link", { name: "Courses" })).toHaveAttribute(
      "href",
      "/courses",
    );
  });

  // A store with no real published course does not show: neither in the bar nor in the
  // phone menu. Without a provider the same "no" as a failed read applies.
  it.each([
    ["no real course", false],
    ["no provider", undefined],
  ])("hides Courses while the store is empty (%s)", (_, value) => {
    render(value === undefined ? <SiteNav /> : <RealCoursesProvider value={value}><SiteNav /></RealCoursesProvider>);

    const withoutCourses = HEADER_ORDER.filter((name) => name !== "Courses");
    expect(linkNames(screen.getByRole("navigation", { name: "Primary navigation" }))).toEqual(withoutCourses);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(linkNames(screen.getByRole("navigation", { name: "Mobile navigation" }))).toEqual(withoutCourses);
    expect(document.querySelector('a[href="/courses"]')).toBeNull();
  });

  it("opens buyer and creator entry in the same tab from the public header", () => {
    render(<SiteNav />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("link", { name: /My courses/ })).toHaveAttribute("href", "/auth?mode=signin&path=student");
    expect(screen.getByRole("link", { name: /Manage my business/ })).not.toHaveAttribute("target");
  });

  // The public bar is where the visitor finds the entry point. In production the menu
  // (desktop and mobile) publishes the short hosts; the sign-up "Get started" and the
  // authenticated Dashboard stay as they are — only the entry by intent changes.
  it("publishes the short hosts from both header menus in production", () => {
    vi.stubGlobal("location", { ...window.location, hostname: "www.skillsetmind.com" });
    render(<SiteNav />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("link", { name: /My courses/ })).toHaveAttribute("href", "https://consumer.skillsetmind.com/auth?mode=signin&path=student");
    expect(screen.getByRole("link", { name: /Manage my business/ })).toHaveAttribute("href", "https://app.skillsetmind.com/auth?mode=signin&path=teacher");
    expect(screen.getByRole("link", { name: /Manage my business/ })).not.toHaveAttribute("target");
    expect(screen.getAllByRole("link", { name: "Create account" })[0]).toHaveAttribute("href", "/auth?mode=signup");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const panel = document.getElementById("site-mobile-menu")!;
    fireEvent.click(within(panel).getByRole("button", { name: "Sign in" }));
    expect(within(panel).getByRole("link", { name: /My courses/ })).toHaveAttribute("href", "https://consumer.skillsetmind.com/auth?mode=signin&path=student");
    expect(within(panel).getByRole("link", { name: /Manage my business/ })).toHaveAttribute("href", "https://app.skillsetmind.com/auth?mode=signin&path=teacher");
  });

  it("keeps the entry links relative on a Vercel preview", () => {
    vi.stubGlobal("location", { ...window.location, hostname: "skillset-foundation-git-feat-links-skillsetmind.vercel.app" });
    render(<SiteNav />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("link", { name: /My courses/ })).toHaveAttribute("href", "/auth?mode=signin&path=student");
    expect(screen.getByRole("link", { name: /Manage my business/ })).toHaveAttribute("href", "/auth?mode=signin&path=teacher");
  });

  it("keeps mobile entry open after Escape dismisses its nested disclosure", () => {
    render(<SiteNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const panel = document.getElementById("site-mobile-menu")!;
    const trigger = within(panel).getByRole("button", { name: "Sign in" });
    fireEvent.click(trigger);
    within(panel).getByRole("link", { name: /My courses/ }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(panel).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(within(panel).getByRole("link", { name: /Manage my business/ })).toBeInTheDocument();
    expect(panel.className).toContain("overflow-y-auto");
    expect(panel.className).toContain("100svh");
  });

  it("lets Escape close the focused mobile menu while a desktop disclosure remains open", () => {
    render(<SiteNav />);
    const desktopEntry = screen.getByRole("button", { name: "Sign in" });
    fireEvent.click(desktopEntry);
    const mobileToggle = screen.getByRole("button", { name: "Open menu" });
    mobileToggle.focus();
    // Keyboard activation does not dispatch the mousedown that dismisses a disclosure.
    fireEvent.click(mobileToggle);
    const mobile = screen.getByRole("navigation", { name: "Mobile navigation" });
    within(mobile).getAllByRole("link")[0].focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(mobile).not.toBeInTheDocument();
    expect(mobileToggle).toHaveFocus();
    expect(desktopEntry).toHaveAttribute("aria-expanded", "true");
  });

  it("offers the language switch in the header as a styled menu, not a native select", () => {
    render(<SiteNav />);

    const trigger = screen.getByRole("button", { name: "Language: English" });
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(trigger);
    const menu = screen.getByRole("listbox", { name: "Language" });
    // Right-aligned so it never leaves the viewport on a 320px header.
    expect(menu).toHaveClass("right-0", "top-full");
    expect(within(menu).getByRole("option", { name: "English" })).toHaveAttribute("aria-selected", "true");
    expect(within(menu).getByRole("option", { name: "Español" })).toHaveAttribute("aria-selected", "false");
  });

  // The phone menu used to let go of focus on the X, let Tab go to the dimmed
  // page behind it, and the page scrolled underneath.
  it("moves focus into the mobile menu, locks the page scroll and gives both back on close", () => {
    render(<RealCoursesProvider value><SiteNav /></RealCoursesProvider>);
    const toggle = screen.getByRole("button", { name: "Open menu" });

    fireEvent.click(toggle);
    const mobile = screen.getByRole("navigation", { name: "Mobile navigation" });
    expect(within(mobile).getAllByRole("link")[0]).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    // The dimmed backdrop is no longer a "Close menu" button in the Tab path.
    expect(screen.getAllByRole("button", { name: "Close menu" })).toHaveLength(1);
    expect(document.getElementById("site-mobile-menu")).toHaveClass("motion-drop-in");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
    expect(toggle).toHaveFocus();
  });

  // Rotated tablet or maximized window with the menu open: the panel, the dimmed backdrop and
  // the X disappear from 1280px up, and the page stayed locked with no way to release it.
  it("closes the mobile menu and frees the page when the window grows past 1280px", () => {
    const listeners = new Set<(event: { matches: boolean }) => void>();
    const desktop = {
      matches: false,
      addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
    };
    const matchMedia = vi.fn(() => desktop);
    vi.stubGlobal("matchMedia", matchMedia);
    render(<SiteNav />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(document.getElementById("site-mobile-menu")).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 1280px)");

    desktop.matches = true;
    act(() => listeners.forEach((listener) => listener({ matches: true })));
    expect(document.getElementById("site-mobile-menu")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(listeners.size).toBe(0);
  });

  it("does not open the mobile menu when the window is already desktop-wide", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<SiteNav />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(document.getElementById("site-mobile-menu")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps Tab inside the header row while the mobile menu is open", () => {
    // jsdom does no layout: here every element counts as visible.
    const rects = vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    try {
      render(<SiteNav />);
      fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
      const row = document.querySelector<HTMLElement>(".site-header__inner")!;
      const panel = document.getElementById("site-mobile-menu")!;
      const panelItems = within(panel).getAllByRole("link");
      const last = panelItems[panelItems.length - 1];

      last.focus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(row.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(last);

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(last).toHaveFocus();
    } finally {
      rects.mockRestore();
    }
  });

  it("closes the mobile menu from the dimmed page, which starts below the header", () => {
    render(<SiteNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const scrim = document.querySelector<HTMLElement>("header ~ div.fixed[aria-hidden='true']")!;
    expect(scrim.className).toContain("top-[var(--site-header-height)]");
    expect(scrim.closest("header")).toBeNull();

    fireEvent.click(scrim);
    expect(document.getElementById("site-mobile-menu")).toBeNull();
  });

  it("keeps the mobile menu in the same order and closes on Escape", () => {
    render(<RealCoursesProvider value><SiteNav /></RealCoursesProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const mobile = screen.getByRole("navigation", {
      name: "Mobile navigation",
    });
    expect(linkNames(mobile)).toEqual(HEADER_ORDER);
    within(mobile).getAllByRole("link")[0].focus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("navigation", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus();
  });
});
// The entry point used three button systems: gold in the bar, navy in the phone
// menu. Now the main action is the same .button-solid in both places.
describe("SiteNav: the same two buttons in the bar and in the phone menu", () => {
  it("'Create account' is the same main button in the bar and in the menu", () => {
    render(<SiteNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const panel = document.getElementById("site-mobile-menu")!;

    const [bar, menu] = screen.getAllByRole("link", { name: "Create account" });
    expect(within(panel).getByRole("link", { name: "Create account" })).toBe(menu);
    for (const link of [bar, menu]) {
      expect(link).toHaveClass("button-solid");
      expect(link).not.toHaveClass("btn-cta-hero");
    }
  });
});
