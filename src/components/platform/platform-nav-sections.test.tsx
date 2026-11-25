import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformNav } from "@/components/platform/platform-nav";

// The sidebar groups ("Products", "Sales"...) came out in raw English in
// every language, and the collapsed icon hint ("Open Products navigation") was
// built by hand. Now both go through the dictionary (platform.navSection.*).

const mocks = vi.hoisted(() => ({
  pathname: "/teach/builder",
  roles: ["teacher"] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "u-1",
      email: "person@example.com",
      displayName: "Person",
      emailVerified: true,
      photoURL: null,
      roles: mocks.roles,
    },
  }),
}));

afterEach(() => {
  cleanup();
  mocks.pathname = "/teach/builder";
  mocks.roles = ["teacher"];
});

describe("translated sidebar groups", () => {
  it("in Spanish, the group and the collapsed icon's hint come out in Spanish", () => {
    render(
      <I18nProvider initialLocale="es">
        <PlatformNav collapsed />
      </I18nProvider>,
    );

    const promote = screen.getByRole("button", { name: "Abrir navegación de Promocionar" });
    // The collapsed icon's hint is the label itself (CSS), not a title.
    expect(promote.querySelector(".platform-sidebar-label")).toHaveTextContent("Promocionar");
    expect(promote).not.toHaveAttribute("title");
    expect(screen.queryByRole("button", { name: /Open Promote navigation/ })).toBeNull();
  });

  it("expanded, the group's label comes from the dictionary", () => {
    render(
      <I18nProvider initialLocale="es">
        <PlatformNav />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Promocionar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ayuda" })).toBeInTheDocument();
    expect(screen.queryByText("Promote")).toBeNull();
  });

  it("without a provider it falls back to English, with the hint built from the dictionary", () => {
    render(<PlatformNav collapsed />);

    expect(
      screen.getByRole("button", { name: "Open Promote navigation" }).querySelector(".platform-sidebar-label"),
    ).toHaveTextContent("Promote");
  });
});

describe("Creator plans outside the sidebar", () => {
  // The plans belong to whoever sells: the teacher reaches them through "Creator plan"
  // in the avatar menu. On the bar, not even a teacher who studies sees them.
  it("a teacher who studies does not see Plans & fees on the bar", () => {
    mocks.roles = ["student", "teacher"];
    mocks.pathname = "/learn/messages";
    render(<PlatformNav />);

    expect(screen.queryByRole("link", { name: "Plans & fees" })).toBeNull();
  });
});

// The learner saw the sellers' plans and a page called "Billing" that only
// holds what they bought.
describe("Learner account: purchases, no creator plan", () => {
  it("the learner sees My purchases and no Plans & fees", () => {
    mocks.roles = ["student"];
    mocks.pathname = "/account/billing";
    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "My purchases" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Billing" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Plans & fees" })).toBeNull();
  });

  it("in Spanish, Mis compras", () => {
    mocks.roles = ["student"];
    mocks.pathname = "/learn/messages";
    render(
      <I18nProvider initialLocale="es">
        <PlatformNav />
      </I18nProvider>,
    );

    expect(screen.getByRole("link", { name: "Mis compras" })).toHaveAttribute("href", "/account/billing");
  });

  it("a teacher who studies still sees Billing", () => {
    mocks.roles = ["student", "teacher"];
    mocks.pathname = "/learn/messages";
    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute("href", "/account/billing");
    expect(screen.queryByRole("link", { name: "My purchases" })).toBeNull();
  });
});

// Sales and Promote looked like section titles (38px, 11.5px in UPPERCASE); in the
// phone drawer they were 30px with a border in the text color, and the current page only
// got a light outline.
describe("first level: groups with the same line as the links, and the current page in view", () => {
  it("the group is 44px, 14px and has a transparent border; the current page has a background in the drawer", () => {
    mocks.pathname = "/teach/sales";
    render(<PlatformNav />);

    const group = screen.getByRole("button", { name: "Promote" });
    expect(group).toHaveClass("h-11", "min-h-11", "px-2.5", "text-sm", "border-transparent");
    expect(group.querySelector(".platform-nav-icon-chip")).toBeInTheDocument();

    const current = document.querySelector('a[aria-current="page"]');
    expect(current).toHaveAttribute("href", "/teach/sales");
    // The stronger background (the earlier light one lost to the hover) and the gold line.
    expect(current).toHaveClass(
      "bg-[var(--color-surface-strong)]",
      "text-[var(--color-primary)]",
      "before:bg-[var(--color-accent)]",
    );
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);

    // Help opens in place like the groups: with the little arrow.
    expect(screen.getByRole("button", { name: "Help" }).querySelector(".platform-nav-section-chevron")).toBeInTheDocument();
  });

  it("in the CSS, the group trigger does not shrink nor become UPPERCASE", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).not.toMatch(/\.platform-nav-section-trigger \.platform-sidebar-label\s*\{[^}]*uppercase/);
    expect(css).not.toMatch(/\.platform-nav-section-trigger \.platform-nav-icon-chip\s*\{[^}]*28px/);
    const trigger = css.slice(css.indexOf(".platform-sidebar .platform-nav-link.platform-nav-section-trigger {"));
    expect(trigger.slice(0, trigger.indexOf("}"))).not.toMatch(/min-height|color: rgba/);
  });
});
