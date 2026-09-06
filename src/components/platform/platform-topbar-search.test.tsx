import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformHeader } from "@/components/platform/platform-header";

// A busca morava dentro da barra lateral e so existia com ela expandida: quem
// recolhia o rail perdia a busca, e no celular — onde a barra vira gaveta — ela
// nao existia em largura nenhuma. E a dica dizia "Ctrl K" fixa, inclusive no
// Mac, onde o atalho e ⌘K (achado F26 da auditoria).

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "teacher-1",
      email: "teacher@example.com",
      displayName: "Teacher",
      emailVerified: true,
      photoURL: null,
      roles: ["teacher"],
    },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "platform.searchTeachPlaceholder": "Search your studio",
        "platform.ops.searchSupport": "Search tickets in this queue",
        "platform.ops.searchVerification": "Search applications in this queue",
        "platform.openSearch": "Open search",
        "platform.breadcrumbLabel": "Breadcrumb",
        "platform.crumbs.teach": "Teach",
        "platform.openMobileNav": "Open menu",
      })[key] ?? key,
  }),
}));

vi.mock("@/components/platform/notification-bell", () => ({
  NotificationBell: () => <div />,
}));

vi.mock("@/components/site/account-menu", () => ({
  AccountMenu: () => <div />,
}));

vi.mock("@/components/shared/theme-toggle", () => ({
  ThemeToggle: () => <div />,
}));

function setPlatform(value: string) {
  Object.defineProperty(window.navigator, "platform", {
    value,
    configurable: true,
  });
}

const realPlatform = window.navigator.platform;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathname = "/teach";
});

afterEach(() => {
  cleanup();
  setPlatform(realPlatform);
});

describe("busca na barra do topo", () => {
  it("uses the theme focus color for the search field boundary", () => {
    let borderColor = "";
    const css = postcss.parse(readFileSync("src/app/globals.css", "utf8"));
    css.walkRules(".platform-topbar-search:focus-within", rule => {
      rule.walkDecls("border-color", declaration => { borderColor = declaration.value; });
    });
    expect(borderColor).toBe("var(--focus-ring)");
  });

  it("uses the compact brand mark beside the mobile account and search controls", () => {
    render(<PlatformHeader />);
    const logo = screen.getByRole("link", { name: "SkillsetMind" });
    expect(logo).toHaveAttribute("href", "/teach");
    expect(logo.querySelector(".logo-wordmark__mark")).not.toBeNull();
    expect(logo.querySelector(".logo-wordmark__full")).toBeNull();
  });

  it("omits both the input and mobile trigger when the page has no search consumer", () => {
    mocks.pathname = "/ops";
    render(<PlatformHeader searchHref={null} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open search" })).toBeNull();
  });

  it.each(["support", "verification"])("keeps the %s queue and existing parameters when submitting", tab => {
    mocks.pathname = "/ops";
    render(<PlatformHeader searchHref={`/ops?tab=${tab}&status=open&q=previous`} />);
    const input = screen.getByRole("searchbox");
    expect(input).toHaveValue("previous");
    expect(input).toHaveAccessibleName(tab === "support" ? "Search tickets in this queue" : "Search applications in this queue");
    fireEvent.change(input, { target: { value: "  Ana & Bruno  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    const next = new URL(mocks.push.mock.calls[0][0], "https://skillset.test");
    expect(next.pathname).toBe("/ops");
    expect(next.searchParams.get("tab")).toBe(tab);
    expect(next.searchParams.get("status")).toBe("open");
    expect(next.searchParams.get("q")).toBe("Ana & Bruno");
  });

  it("restores the URL query on Back without losing focus, and submits an empty query to clear it", () => {
    mocks.pathname = "/ops";
    const { rerender } = render(<PlatformHeader searchHref="/ops?tab=support&q=Ana" />);
    const input = screen.getByRole("searchbox");
    input.focus();
    rerender(<PlatformHeader searchHref="/ops?tab=support&q=Bruno" />);
    expect(input).toHaveValue("Bruno");
    rerender(<PlatformHeader searchHref="/ops?tab=support&q=Ana" />);
    expect(input).toHaveValue("Ana");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.push).toHaveBeenLastCalledWith("/ops?tab=support");
  });

  it.each([
    ["/teach", "/teach?query=course%20name"],
    ["/courses", "/courses?q=course%20name"],
    ["/learn", "/courses?q=course%20name"],
  ])("preserves the existing search destination outside Ops: %s", (pathname, expected) => {
    mocks.pathname = pathname;
    render(<PlatformHeader />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: " course name " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.push).toHaveBeenLastCalledWith(expected);
  });

  it("desenha o campo de busca na barra do topo, nao na lateral", () => {
    render(<PlatformHeader />);

    const field = screen.getByRole("searchbox", { name: "Search your studio" });
    expect(field).toBeInTheDocument();
    expect(field.closest("header")).toHaveClass("platform-topbar");
  });

  it("no celular o campo continua alcancavel: um botao o abre", () => {
    render(<PlatformHeader />);

    const toggle = screen.getByRole("button", { name: "Open search" });
    const field = screen.getByRole("searchbox", { name: "Search your studio" });

    // O CSS esconde o campo abaixo de 768px; `data-open` e o que o traz de
    // volta, e e o unico estado que o jsdom consegue observar.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(field.closest("label")).toHaveAttribute("data-open", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(field.closest("label")).toHaveAttribute("data-open", "true");
    expect(field).toHaveFocus();
  });

  it("no Mac a dica e ⌘K", () => {
    setPlatform("MacIntel");
    render(<PlatformHeader />);

    expect(screen.getByText("⌘K")).toBeInTheDocument();
    expect(screen.queryByText("Ctrl K")).toBeNull();
  });

  it("fora do Mac a dica e Ctrl K", () => {
    setPlatform("Win32");
    render(<PlatformHeader />);

    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
    expect(screen.queryByText("⌘K")).toBeNull();
  });

  it("o texto do campo acompanha a area em que a pessoa esta", () => {
    mocks.pathname = "/courses";
    render(<PlatformHeader />);

    expect(
      screen.getByRole("searchbox", { name: "platform.searchDefaultPlaceholder" }),
    ).toBeInTheDocument();
  });
});
