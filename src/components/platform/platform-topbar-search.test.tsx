import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformHeader } from "@/components/platform/platform-header";

// A busca morava dentro da barra lateral e so existia com ela expandida: quem
// recolhia o rail perdia a busca, e no celular — onde a barra vira gaveta — ela
// nao existia em largura nenhuma. E a dica dizia "Ctrl K" fixa, inclusive no
// Mac, onde o atalho e ⌘K (achado F26 da auditoria).

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
  mocks.pathname = "/teach";
});

afterEach(() => {
  cleanup();
  setPlatform(realPlatform);
});

describe("busca na barra do topo", () => {
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
