import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformNav } from "@/components/platform/platform-nav";
import { SidebarToggle } from "@/components/platform/sidebar-toggle";

// Collapsed sidebar: the icons lost their name (only the groups had a tooltip),
// "Operations" was a group with a single item of the same name, and the expand
// button sat loose on the edge, on top of the line between bar and content.

const mocks = vi.hoisted(() => ({
  pathname: "/ops",
  roles: ["admin"] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "admin-1",
      email: "admin@example.com",
      displayName: "Admin",
      emailVerified: true,
      photoURL: null,
      roles: mocks.roles,
    },
  }),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    // Key -> last segment, enough for the test to read the labels.
    t: (key: string) => key.split(".").at(-1) ?? key,
  }),
}));

describe("barra lateral recolhida", () => {
  beforeEach(() => {
    mocks.pathname = "/ops";
    mocks.roles = ["admin"];
  });

  // Wave E: the collapsed icon's name is the label itself, which the CSS shows as a
  // tooltip on hover and focus. The native title (mouse only, after 1s) is gone: with
  // both, the tooltip showed up doubled.
  it("names every collapsed icon (the label in the DOM) and has no title, collapsed or not", () => {
    const { unmount } = render(<PlatformNav collapsed />);

    const collapsedLinks = screen.getAllByRole("link");
    expect(collapsedLinks.length).toBeGreaterThan(0);
    for (const link of collapsedLinks) {
      expect(link).not.toHaveAttribute("title");
      expect(link.querySelector(".platform-sidebar-label")?.textContent).toBeTruthy();
      expect(link).toHaveAccessibleName(/\S/);
    }

    unmount();
    render(<PlatformNav collapsed={false} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("title");
    }
  });

  it("the Operations queues are direct items, with no group or redundant link", () => {
    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "verification" })).toHaveAttribute(
      "href",
      "/ops?tab=verification",
    );
    expect(screen.queryByRole("link", { name: "operations" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /operations/i }),
    ).not.toBeInTheDocument();
  });

  it("Students uses Users in the rail and expanded, without swapping the media library's Image", () => {
    mocks.roles = ["teacher"];
    mocks.pathname = "/teach/students";
    const { rerender } = render(<PlatformNav collapsed initialSection="promote" />);

    const students = screen.getByRole("link", { name: "students" });
    expect(students).toHaveAttribute("href", "/teach/students");
    expect(students.querySelector(".platform-sidebar-label")).toHaveTextContent("students");
    expect(students).toHaveAttribute("aria-current", "page");
    expect(students.querySelector("svg.lucide-users")).toBeInTheDocument();

    rerender(<PlatformNav initialSection="promote" />);
    const expandedStudents = screen.getByRole("link", { name: "students" });
    expect(expandedStudents.querySelector("svg.lucide-users")).toBeInTheDocument();
    expect(expandedStudents).not.toHaveAttribute("title");
    const media = screen.getByRole("link", { name: "mediaLibrary" });
    expect(media).toHaveAttribute("href", "/teach/media");
    expect(media.querySelector("svg.lucide-image")).toBeInTheDocument();
  });
});

// Extra items from wave 3 (the owner's screenshots, 02/09): in the rail, the group
// trigger (Sales, Products...) lit up in TWO layers on hover — the item's
// background, as wide as the rail and clipped at the sides, plus the icon chip
// inside — while the direct link (Earnings) lit up in just one. Now both
// are the same 44px square, centered in the 64px, with no chip.
describe("collapsed rail: one square per item, no chip and no clipping", () => {
  it("group trigger and direct link have the same structure: the icon directly, no chip", () => {
    mocks.roles = ["teacher"];
    mocks.pathname = "/teach/builder";
    const { container, unmount } = render(<PlatformNav collapsed />);

    expect(container.querySelectorAll(".platform-nav-icon-chip")).toHaveLength(0);
    const items = [...container.querySelectorAll("a, button")];
    expect(items.length).toBeGreaterThan(3);
    expect(items.some((item) => item.classList.contains("platform-nav-section-trigger"))).toBe(true);
    for (const item of items) {
      expect(item.firstElementChild?.tagName.toLowerCase(), item.className).toBe("svg");
    }

    // Expanded, the chip stays (it aligns icon and label).
    unmount();
    render(<PlatformNav />);
    expect(document.querySelectorAll(".platform-nav-icon-chip").length).toBeGreaterThan(3);
  });

  it("in the CSS, the rail item is a centered 44px square, and the rule comes after the trigger's", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const rail = ".platform-sidebar.sidebar-collapsed .platform-nav-link {";
    const start = css.indexOf(rail);
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("\n}", start));
    expect(block).toContain("width: 44px");
    expect(block).toContain("height: 44px");
    expect(block).toContain("margin-inline: auto");
    expect(block).toContain("padding: 0 !important");

    // A thin Windows scrollbar takes 10px: two gutters left only 43px in
    // the 63px inner rail. One gutter leaves room for the 44px target and focus.
    expect(css.includes("scrollbar-gutter: stable both-edges")).toBe(false);
    expect(css).toMatch(/\.platform-grid--collapsed \.platform-sidebar-panel\s*\{\s*padding-inline: 0;/);
    // Brass focus on the rail's navy (the owner's decision): 5.62:1 on the worst shade.
    expect(css).toMatch(/\.platform-sidebar-panel\s*\{[^}]*--focus-ring: var\(--color-accent\);/);
    expect(css).toMatch(/\.platform-sidebar\.sidebar-collapsed \.platform-nav-link:focus-visible\s*\{\s*outline-offset: 2px;/);
    expect(css).toMatch(/\.platform-sidebar\.sidebar-collapsed \.platform-nav-link\.platform-nav-active svg\s*\{\s*color: #102a43 !important;/);

    // The trigger's hover and the rail's hover tie in specificity (0,4,0):
    // the rail's only wins by coming AFTER. Before that it was the second layer.
    const triggerHover = css.indexOf(".platform-sidebar .platform-nav-link.platform-nav-section-trigger:hover");
    const railHover = css.indexOf(".platform-sidebar.sidebar-collapsed .platform-nav-link:hover {");
    expect(triggerHover).toBeGreaterThan(-1);
    expect(railHover).toBeGreaterThan(triggerHover);

    // The highlight no longer lives on the chip.
    expect(css).not.toMatch(/\.sidebar-collapsed[^{]*\.platform-nav-icon-chip[^{]*\{[^}]*background: (?!transparent)/);
  });

  it("in the CSS, rail sections and footer inherit the same nav gap without losing the grid or separator", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.platform-sidebar-nav\s*\{\s*gap: 0\.35rem;/);
    expect(css).toMatch(/\.platform-nav-section\s*\{\s*display: grid;\s*gap: 0\.25rem;/);
    expect(css).toMatch(
      /\.platform-nav-footer\s*\{\s*display: grid;\s*gap: 0\.25rem;\s*margin-top: auto;\s*border-top: 1px solid[^;]+;\s*padding-top: 0\.5rem;/,
    );
    expect(css).toMatch(
      /\.platform-sidebar\.sidebar-collapsed \.platform-nav-section,\s*\.platform-sidebar\.sidebar-collapsed \.platform-nav-footer\s*\{\s*gap: inherit;\s*\}/,
    );
  });

  // The brand at the top of the rail sat pushed to the left (flex without justify,
  // 4px of padding) while the icons below were centered squares:
  // it looked displaced. In the rail it centers on the same axis.
  it("in the CSS, the collapsed rail's brand centers on the same axis as the icons", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(
      /\.platform-sidebar\.sidebar-collapsed \.platform-sidebar-brand\s*\{[^}]*justify-content: center;[^}]*padding-inline: 0;/,
    );
  });
});

describe("the collapse/expand button", () => {
  it("is a bar item (same class as the links, 44px target), not a circle on the edge", () => {
    render(
      <SidebarToggle collapsed controls="nav" onToggle={() => {}} />,
    );

    const button = screen.getByRole("button", { name: "expandSidebar" });
    expect(button.className).toMatch(/\bplatform-nav-link\b/);
    expect(button.className).toMatch(/\bplatform-sidebar-toggle\b/);
    expect(button.className).toMatch(/\bsize-11\b/);
  });

  it("sits at the top of the bar, before the list (wave E: Hotmart's ☰), and the CSS does not hang it on the edge", () => {
    const shell = readFileSync(
      path.join(process.cwd(), "src/components/platform/platform-shell.tsx"),
      "utf8",
    );
    const css = readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    // In JSX order: the ☰ comes before the list.
    expect(shell.indexOf("<SidebarToggle")).toBeLessThan(
      shell.indexOf("<PlatformNav"),
    );
    // The old rules selected the button by aria-label and pinned it to the
    // edge (position: absolute; right: -1.1rem). They are gone.
    expect(css).not.toMatch(/button\[aria-label="(Expand|Collapse) sidebar"\]/);
    expect(css).toContain(".platform-sidebar .platform-sidebar-toggle");
  });
});
