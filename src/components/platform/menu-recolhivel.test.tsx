import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformShell } from "@/components/platform/platform-shell";
import { parseSidebarPref, SIDEBAR_COOKIE, type SidebarPref } from "@/lib/ui/sidebar-cookie";
import { SidebarPreferenceProvider } from "@/lib/ui/sidebar-preference";

// Wave E, part 2: a collapsible sidebar in the style of Hotmart. Open, icon
// and name; closed, only the icon, with the name as a hint on hover and focus. The
// choice lives in a cookie that the server reads: the first HTML already comes out right.

const mocks = vi.hoisted(() => ({ pathname: "/teach" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "teacher-test", displayName: "Teacher", roles: ["teacher"] } }),
}));
vi.mock("./platform-header", () => ({ PlatformHeader: () => null }));
vi.mock("./status-banner", () => ({ StatusBanner: () => null }));
vi.mock("@/components/teacher/use-teacher-inbox-count", () => ({ useTeacherInboxCount: () => undefined }));

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");

function setCookie(pref: SidebarPref) {
  document.cookie = pref
    ? `${SIDEBAR_COOKIE}=${pref}; path=/`
    : `${SIDEBAR_COOKIE}=; max-age=0; path=/`;
}

/** A window of `width` px for `matchMedia` (jsdom does not evaluate media queries). */
function viewport(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const min = Number(query.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
    const below = Number(query.match(/width\s*<\s*(\d+)px/)?.[1] ?? Infinity);
    return {
      matches: width >= min && width < below,
      addEventListener() {},
      removeEventListener() {},
    };
  });
}

function shell(children: ReactNode = "Content") {
  return <PlatformShell title="Home">{children}</PlatformShell>;
}

function sidebar() {
  return document.querySelector(".platform-sidebar")!;
}

function toggleButton() {
  return screen.getByRole("button", { name: /^(Expand|Collapse) menu$/ });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCookie(null);
  mocks.pathname = "/teach";
});

describe("a escolha vem do cookie, lida no servidor", () => {
  function serverHtml(pref: SidebarPref) {
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      <SidebarPreferenceProvider value={pref}>{shell()}</SidebarPreferenceProvider>,
    );
    return host;
  }

  it("cookie 'collapsed': the first HTML already comes out collapsed, with the ☰ saying 'Expand menu'", () => {
    const html = serverHtml("collapsed");
    expect(html.querySelector(".platform-grid")).toHaveClass("platform-grid--collapsed");
    expect(html.querySelector(".platform-grid")).not.toHaveClass("platform-grid--auto");
    expect(html.querySelector(".platform-sidebar")).toHaveClass("sidebar-collapsed");
    const toggle = html.querySelector(".platform-sidebar-toggle")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-label", "Expand menu");
    // Collapsed, the top row is just the ☰ (without the wide brand mark).
    expect(html.querySelector(".platform-sidebar-brand__lockup-link")).toBeNull();
  });

  it("cookie 'expanded': open, without depending on the screen width", () => {
    const html = serverHtml("expanded");
    expect(html.querySelector(".platform-grid")!.className).not.toMatch(/platform-grid--(collapsed|auto)/);
    expect(html.querySelector(".platform-sidebar")).toHaveClass("sidebar-expanded");
    expect(html.querySelector(".platform-sidebar-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(html.querySelector(".platform-sidebar-brand__lockup-link")).not.toBeNull();
  });

  it("no cookie: the grid comes out 'auto' and the CSS decides the width by the screen", () => {
    const html = serverHtml(null);
    expect(html.querySelector(".platform-grid")).toHaveClass("platform-grid--auto");
    expect(html.querySelector(".platform-grid")).not.toHaveClass("platform-grid--collapsed");
  });

  it("hydrating the server HTML changes nothing (no flicker, no mismatch)", async () => {
    setCookie("collapsed");
    const host = serverHtml("collapsed");
    document.body.appendChild(host);
    const before = host.innerHTML;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const mismatches = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(
        host,
        <SidebarPreferenceProvider value="collapsed">{shell()}</SidebarPreferenceProvider>,
        { onRecoverableError: mismatches },
      );
    });
    expect(mismatches).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelector(".platform-sidebar")).toHaveClass("sidebar-collapsed");
    expect(host.innerHTML).toBe(before);
    act(() => root!.unmount());
    host.remove();
  });

  it("only the signed-in areas read the cookie; an odd value counts as 'no choice'", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    // The root layout wraps the home and the public pages: nothing from the bar in it.
    const root = read("src/app/layout.tsx");
    expect(root).not.toMatch(/@\/lib\/ui\/sidebar|sidebar-preference|SidebarPreference/);
    expect(read("src/components/platform/sidebar-preference-layout.tsx")).toContain(
      "parseSidebarPref((await cookies()).get(SIDEBAR_COOKIE)?.value)",
    );
    for (const area of ["account", "learn", "ops", "support", "teach"]) {
      expect(read(`src/app/${area}/layout.tsx`), area).toContain("@/components/platform/sidebar-preference-layout");
    }
    expect(parseSidebarPref("collapsed")).toBe("collapsed");
    expect(parseSidebarPref("expanded")).toBe("expanded");
    expect(parseSidebarPref("open")).toBeNull();
    expect(parseSidebarPref(undefined)).toBeNull();
  });
});

describe("the ☰ button", () => {
  it("it is a real <button> with aria-expanded, aria-controls on the list and a name that says what it does", () => {
    render(shell());
    const toggle = toggleButton();
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAccessibleName("Collapse menu");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const nav = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(nav).toBe(screen.getByRole("navigation", { name: "Workspace" }));
    // At the top of the bar, before the list (as in Hotmart), not at the bottom.
    expect(toggle.closest(".platform-sidebar-brand")).not.toBeNull();
    expect(toggle.compareDocumentPosition(nav!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("collapses and opens, and writes the choice to the cookie (which the server reads on the next load)", () => {
    render(shell());
    fireEvent.click(toggleButton());
    expect(sidebar()).toHaveClass("sidebar-collapsed");
    expect(toggleButton()).toHaveAccessibleName("Expand menu");
    expect(toggleButton()).toHaveAttribute("aria-expanded", "false");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=collapsed`);

    fireEvent.click(toggleButton());
    expect(sidebar()).toHaveClass("sidebar-expanded");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=expanded`);
  });

  it("the choice survives a page change (each page mounts its own shell)", () => {
    const first = render(shell());
    fireEvent.click(toggleButton());
    first.unmount();
    // The provider still has the first load's value; the cookie is what counts.
    render(<SidebarPreferenceProvider value={null}>{shell()}</SidebarPreferenceProvider>);
    expect(sidebar()).toHaveClass("sidebar-collapsed");
  });

  it("in Spanish: 'Contraer menú' / 'Expandir menú'", () => {
    render(<I18nProvider initialLocale="es">{shell()}</I18nProvider>);
    const toggle = screen.getByRole("button", { name: "Contraer menú" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName("Expandir menú");
  });

  it("the icon is ☰ when collapsed and becomes an arrow when open, with transform only", () => {
    expect(css).toMatch(
      /\.platform-sidebar:not\(\.sidebar-collapsed\) \.platform-menu-icon path:first-child \{\s*transform: translateY\(6px\) rotate\(-45deg\) scaleX\(0\.53\);/,
    );
    expect(css).toMatch(
      /\.platform-sidebar:not\(\.sidebar-collapsed\) \.platform-menu-icon path:last-child \{\s*transform: translateY\(-6px\) rotate\(45deg\) scaleX\(0\.53\);/,
    );
    render(shell());
    expect(toggleButton().querySelectorAll(".platform-menu-icon path")).toHaveLength(3);
  });
});

describe("collapsed: name as a hint on hover and focus, and an accessible name", () => {
  it("each item has an accessible name and the label in the DOM; no title (a doubled native hint)", () => {
    setCookie("collapsed");
    render(shell());
    expect(sidebar()).toHaveClass("sidebar-collapsed");
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    const items = within(nav).getAllByRole("link").concat(within(nav).getAllByRole("button"));
    expect(items.length).toBeGreaterThan(5);
    for (const item of items) {
      expect(item).not.toHaveAttribute("title");
      expect(item.querySelector(".platform-sidebar-label")?.textContent).toBeTruthy();
      expect(item).toHaveAccessibleName(/\S/);
    }
    expect(within(nav).getByRole("link", { name: "Students" })).toHaveAttribute("href", "/teach/students");
  });

  it("hover and focus tell the hint where to sit (--tip-x/--tip-y)", () => {
    setCookie("collapsed");
    render(shell());
    const students = screen.getByRole("link", { name: "Students" });
    fireEvent.mouseOver(students);
    expect(students.style.getPropertyValue("--tip-y")).toMatch(/^\d+px$/);
    const inbox = screen.getByRole("link", { name: "Inbox" });
    fireEvent.focus(inbox);
    expect(inbox.style.getPropertyValue("--tip-x")).toMatch(/^\d+px$/);
  });

  it("in the CSS, the hint lights up on hover AND keyboard focus, fixed (the list scrolls) and only after measuring", () => {
    const start = css.indexOf(".platform-sidebar.sidebar-collapsed .platform-nav-link[style]:is(:hover, :focus-visible) .platform-sidebar-label,");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain(".platform-sidebar .platform-sidebar-toggle[style]:is(:hover, :focus-visible) .platform-sidebar-label");
    expect(rule).toContain("position: fixed;");
    expect(rule).toContain("top: var(--tip-y);");
    expect(rule).toContain("left: var(--tip-x);");
    // Outside hover/focus the label stays in the DOM (accessible name), only clipped.
    expect(css).toMatch(
      /\.sidebar-collapsed \.platform-sidebar-label,\s*\.platform-sidebar-toggle \.platform-sidebar-label \{\s*position: absolute;\s*width: 1px;\s*height: 1px;\s*overflow: hidden;\s*clip-path: inset\(50%\);/,
    );
  });
});

describe("groups and Help with the sidebar collapsed", () => {
  it("on desktop, a collapsed Promote opens the sidebar itself already on the group", () => {
    viewport(1280);
    setCookie("collapsed");
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Open Promote navigation" }));
    expect(sidebar()).toHaveClass("sidebar-expanded");
    expect(screen.getByRole("button", { name: "Promote" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Media library" })).toHaveAttribute("href", "/teach/media");
  });

  it("in the mid range (1100px), Sales opens the drawer on the group, without saving a choice", () => {
    viewport(1100);
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Open Sales navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Platform navigation" });
    expect(within(drawer).getByRole("button", { name: "Sales" })).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("link", { name: "Subscriptions" })).toHaveAttribute("href", "/teach/subscriptions");
    expect(document.cookie).not.toContain(SIDEBAR_COOKIE);
  });

  it("a single Help, with a name, that opens the choices (drawer on the rail, sidebar on desktop)", () => {
    viewport(1100);
    const { unmount } = render(shell());
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    expect(within(nav).getAllByRole("button", { name: "Help" })).toHaveLength(1);
    fireEvent.click(within(nav).getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog", { name: "What do you need help with?" })).toBeInTheDocument();
    unmount();

    viewport(1280);
    setCookie("collapsed");
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(sidebar()).toHaveClass("sidebar-expanded");
    expect(screen.getByRole("dialog", { name: "What do you need help with?" })).toBeInTheDocument();
  });
});

describe("mid-size screens: the rail is the default", () => {
  it.each([
    [1100, null, "sidebar-collapsed"],
    [1100, "expanded", "sidebar-expanded"],
    [1179, null, "sidebar-collapsed"],
    [900, "expanded", "sidebar-collapsed"],
    [1180, null, "sidebar-expanded"],
    [1180, "collapsed", "sidebar-collapsed"],
  ] as const)("at %ipx with choice %s: %s", (width, pref, expected) => {
    viewport(width);
    setCookie(pref);
    render(shell());
    expect(sidebar()).toHaveClass(expected);
  });

  it("in the CSS, with no saved choice the column is the 64px rail from 768 to 1179px already on the 1st frame", () => {
    const start = css.indexOf("@media (min-width: 768px) and (width < 1180px) {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("\n}\n", start));
    expect(block).toMatch(/\.platform-grid--auto \{\s*--platform-sidebar-width: 64px;/);
    // What does not fit in 64px disappears until the JS mounts.
    expect(block).toContain(".platform-sidebar-brand__lockup-link");
    expect(block).toContain(".platform-nav-section-items");
  });
});

describe("light motion, and none with 'reduce motion'", () => {
  const blocks = (() => {
    const ranges: string[] = [];
    const opener = "@media (prefers-reduced-motion: no-preference) {";
    for (let at = css.indexOf(opener); at !== -1; at = css.indexOf(opener, at + 1)) {
      let depth = 0;
      let end = css.indexOf("{", at);
      for (; end < css.length; end += 1) {
        if (css[end] === "{") depth += 1;
        if (css[end] === "}" && --depth === 0) break;
      }
      ranges.push(css.slice(at, end));
    }
    return ranges;
  })();
  const noPreference = blocks.join("\n");

  it("the width switches instantly: neither the grid nor the panel animates layout", () => {
    expect(css).not.toMatch(/transition: grid-template-columns/);
    expect(css).not.toMatch(/\.platform-sidebar-panel \{[^}]*transition: width/);
  });

  it("the name lights up and the ☰ rotates in 180ms, only inside no-preference and with the tokens", () => {
    expect(noPreference).toMatch(/\.platform-sidebar-label \{\s*transition: opacity var\(--duration-base\) var\(--ease-standard\);/);
    expect(noPreference).toMatch(/\.platform-menu-icon path \{\s*transition: transform var\(--duration-base\) var\(--ease-standard\);/);
    expect(css).toContain("--duration-base: 180ms;");
    // Outside no-preference, no transition on the label or the icon.
    const outside = blocks.reduce((rest, block) => rest.replace(block, ""), css);
    expect(outside).not.toMatch(/\.platform-sidebar-label \{[^}]*transition/);
    expect(outside).not.toMatch(/\.platform-menu-icon path \{[^}]*transition/);
  });
});

// ─── Second round: fixes from the PR review ─────────────────────────────

const MEDIUM = "(min-width: 768px) and (width < 1180px)";
const TABLET = "(min-width: 768px) and (width < 1024px)";

function mediaBlock(query: string) {
  const start = css.indexOf(`@media ${query} {`);
  expect(start, query).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}\n", start));
}

/** The `{ ... }` body of the rule with exactly this selector, inside `scope`. */
function ruleBody(scope: string, selector: string) {
  const at = scope.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return scope.slice(scope.indexOf("{", at), scope.indexOf("}", at) + 1);
}

function serverRender(pref: SidebarPref) {
  const host = document.createElement("div");
  host.innerHTML = renderToString(
    <SidebarPreferenceProvider value={pref}>{shell()}</SidebarPreferenceProvider>,
  );
  return host;
}

describe("tablet: the brand mark returns to the top of the rail", () => {
  it("collapsed, the top row has the ☰ and the small brand mark, which leads home without prefetch", () => {
    const html = serverRender("collapsed");
    const brand = html.querySelector(".platform-sidebar-brand")!;
    const mark = brand.querySelector("a.platform-sidebar-brand__mark")!;
    expect(mark).toHaveAttribute("href", "/teach");
    expect(mark).toHaveAccessibleName("SkillsetMind");
    for (const img of mark.querySelectorAll("img")) expect(img).toHaveAttribute("loading", "lazy");
    expect(brand.querySelector(".platform-sidebar-toggle")).not.toBeNull();
    expect(brand.querySelector(".platform-sidebar-brand__lockup-link")).toBeNull();
  });

  it("with no saved choice the small brand mark already comes in the server HTML (tablet's 1st frame); open by choice, it does not", () => {
    expect(serverRender(null).querySelector(".platform-sidebar-brand__mark")).not.toBeNull();
    expect(serverRender("expanded").querySelector(".platform-sidebar-brand__mark")).toBeNull();
  });

  it("in the CSS, the brand mark only appears from 768 to 1023px, where the ☰ goes away: the two never share the row", () => {
    expect(css).toMatch(/\n\.platform-sidebar-brand__mark \{\s*display: none;\s*\}/);
    expect(css).toMatch(/\n\.platform-sidebar-brand__mark img \{\s*width: 2rem;\s*height: 2rem;\s*\}/);
    const tablet = mediaBlock(TABLET);
    expect(ruleBody(tablet, "  .platform-sidebar-brand__mark")).toMatch(/display: inline-flex;/);
    expect(ruleBody(tablet, "  .platform-sidebar .platform-sidebar-toggle")).toMatch(/display: none;/);
    // Nowhere else does the brand mark light up (above 1023px the ☰ takes the row).
    expect(css.match(/\.platform-sidebar-brand__mark \{/g)).toHaveLength(2);
  });
});

describe("1024–1179px with no choice: the 1st frame is already the rail that the JS draws", () => {
  const auto = ".platform-grid--auto:not(.platform-grid--collapsed)";

  // The active item's gold line sits in the middle of the row. The item also carries
  // `before:-translate-y-1/2` (phone drawer), which uses the `translate`
  // property: with `transform: translateY(-50%)` in the rule the two added up
  // and the line sat 9px above the icon.
  it("the active item's gold line centered: a single offset, through the same property as the classes", () => {
    const filete = ruleBody(css, ".platform-sidebar .platform-nav-active::before");
    expect(filete).toMatch(/top: 50%;/);
    expect(filete).toMatch(/translate: 0 -50%;/);
    expect(filete).not.toMatch(/translateY/);
  });

  it("active in a 44px white square, icons without a little box, no gold line and the scroll gutter reserved", () => {
    const medium = mediaBlock(MEDIUM);
    const active = ruleBody(medium, `  ${auto} .platform-nav-link:is(.platform-nav-active, .platform-nav-section-active)`);
    expect(active).toMatch(/width: 44px;/);
    expect(active).toMatch(/margin-inline: auto;/);
    expect(active).toMatch(/background: #ffffff !important;/);
    expect(ruleBody(medium, `  ${auto} .platform-nav-link:is(.platform-nav-active, .platform-nav-section-active) svg`))
      .toMatch(/color: #102a43 !important;/);
    expect(ruleBody(medium, `  ${auto} .platform-nav-active::before`)).toMatch(/content: none;/);
    const chip = ruleBody(medium, `  ${auto} .platform-nav-icon-chip`);
    expect(chip).toMatch(/background: transparent !important;/);
    expect(chip).toMatch(/box-shadow: none !important;/);
    expect(ruleBody(medium, `  ${auto} .platform-sidebar-nav`)).toMatch(/scrollbar-gutter: stable;/);
  });

  it("it is the same design as the collapsed rail, and wins over the active trigger (same specificity, comes later)", () => {
    expect(css).toMatch(/\.platform-sidebar\.sidebar-collapsed \.platform-nav-link\.platform-nav-active \{\s*background: #ffffff !important;/);
    expect(css).toMatch(/\.platform-sidebar\.sidebar-collapsed \.platform-sidebar-nav \{[^}]*scrollbar-gutter: stable;/);
    expect(css.indexOf(`${auto} .platform-nav-link:is(.platform-nav-active`)).toBeGreaterThan(
      css.indexOf(".platform-sidebar .platform-nav-link.platform-nav-section-trigger.platform-nav-section-active"),
    );
  });
});

describe("tablet with the 'expanded' cookie: the server HTML is already the rail", () => {
  // The mid-range rules apply, on the tablet, to ANY grid that is not
  // collapsed — not only without a cookie. Same body, wider selector.
  const suffixes = [
    " .platform-sidebar-panel",
    " :is(.platform-nav-section-items, .platform-nav-section-chevron, .platform-sidebar-brand__lockup-link)",
    " :is(.platform-sidebar-brand, .platform-nav-link)",
    " :is(.platform-nav-section, .platform-nav-footer)",
    " .platform-sidebar-nav",
    " .platform-nav-icon-chip",
    " .platform-nav-link:is(.platform-nav-active, .platform-nav-section-active)",
    " .platform-nav-link:is(.platform-nav-active, .platform-nav-section-active) svg",
    " .platform-nav-active::before",
  ];

  it.each(suffixes)("%s: same mid-range rule, for .platform-grid:not(.platform-grid--collapsed)", (suffix) => {
    const medium = ruleBody(mediaBlock(MEDIUM), `  .platform-grid--auto:not(.platform-grid--collapsed)${suffix}`);
    const tablet = ruleBody(mediaBlock(TABLET), `  .platform-grid:not(.platform-grid--collapsed)${suffix}`);
    expect(tablet).toBe(medium);
  });

  it("the wide brand mark and the group items disappear: nothing spills over the top bar", () => {
    const hide = ruleBody(
      mediaBlock(TABLET),
      "  .platform-grid:not(.platform-grid--collapsed) :is(.platform-nav-section-items, .platform-nav-section-chevron, .platform-sidebar-brand__lockup-link)",
    );
    expect(hide).toMatch(/display: none;/);
    // And the server does send the wide brand mark in that case (that is what had to disappear).
    expect(serverRender("expanded").querySelector(".platform-sidebar-brand__lockup-link")).not.toBeNull();
  });
});

describe("the rail hint: one at a time, and it goes away when the list scrolls", () => {
  function tipped() {
    return sidebar().querySelectorAll(".platform-nav-link[style]");
  }

  it("the mouse on an item clears the hint of the keyboard-focused item (and vice versa)", () => {
    setCookie("collapsed");
    render(shell());
    const students = screen.getByRole("link", { name: "Students" });
    const inbox = screen.getByRole("link", { name: "Inbox" });
    fireEvent.focus(inbox);
    expect(inbox).toHaveAttribute("style");
    fireEvent.mouseOver(students);
    expect(students).toHaveAttribute("style");
    expect(inbox).not.toHaveAttribute("style");
    expect(tipped()).toHaveLength(1);
    fireEvent.focus(inbox);
    expect(students).not.toHaveAttribute("style");
    expect(tipped()).toHaveLength(1);
  });

  it("scrolling the list clears the hint (it would stay stuck in the old place)", () => {
    setCookie("collapsed");
    render(shell());
    fireEvent.mouseOver(screen.getByRole("link", { name: "Students" }));
    expect(tipped()).toHaveLength(1);
    fireEvent.scroll(screen.getByRole("navigation", { name: "Workspace" }));
    expect(tipped()).toHaveLength(0);
  });

  it("when open, hovering an item measures nothing; only the ☰ (the only open hint) measures", () => {
    render(shell());
    expect(sidebar()).toHaveClass("sidebar-expanded");
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    for (const item of within(nav).getAllByRole("link")) {
      fireEvent.mouseOver(item);
      fireEvent.focus(item);
    }
    expect(tipped()).toHaveLength(0);
    fireEvent.mouseOver(toggleButton());
    expect(toggleButton().style.getPropertyValue("--tip-x")).toMatch(/^\d+px$/);
  });
});

describe("the rail's Help after the drawer", () => {
  it("closing the drawer does not leave the rail's Help saying 'expanded'", () => {
    viewport(1100);
    render(shell());
    const help = within(sidebar() as HTMLElement).getByRole("button", { name: "Help" });
    fireEvent.click(help);
    const drawer = screen.getByRole("dialog", { name: "Platform navigation" });
    expect(within(drawer).getByRole("dialog", { name: "What do you need help with?" })).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "Close navigation" }));
    expect(screen.queryByRole("dialog", { name: "Platform navigation" })).toBeNull();
    expect(help).toHaveAttribute("aria-expanded", "false");
  });
});

describe("the old localStorage key", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("is erased when the sidebar module reaches the browser", async () => {
    localStorage.setItem("skillset_sidebar_state", "collapsed");
    vi.resetModules();
    const fresh = await import("@/lib/ui/sidebar-state");
    expect(fresh.LEGACY_SIDEBAR_KEY).toBe("skillset_sidebar_state");
    expect(localStorage.getItem("skillset_sidebar_state")).toBeNull();
  });

  it("blocked storage does not bring the page down", async () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.resetModules();
    await expect(import("@/lib/ui/sidebar-state")).resolves.toHaveProperty("useSidebarState");
  });
});
