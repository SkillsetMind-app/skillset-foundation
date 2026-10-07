import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { MobileSidebarDrawer } from "@/components/platform/mobile-sidebar-drawer";
import { PlatformHeader } from "@/components/platform/platform-header";
import { PlatformNav } from "@/components/platform/platform-nav";

// Trocar de lado (aluno <-> professor). Antes: um link no rodape da barra,
// "Switch view" escondido no menu do avatar, e o atalho do site publico abria
// ABA NOVA — para quem tem pouca familiaridade com a internet, aba nova e "o
// site sumiu". Agora: UM botao a vista no topo, na mesma aba; no celular, o
// nome do lado no topo e o atalho para o outro lado na barra de baixo.

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
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
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/platform/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/shared/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/lib/data/user-profiles", () => ({ subscribeToUserProfile: () => () => {} }));

afterEach(() => {
  cleanup();
  mocks.pathname = "/teach";
  mocks.roles = ["teacher"];
});

describe("botao de troca de lado no topo", () => {
  it.each([
    ["/teach", "Go to student area", "/learn", "Teacher area"],
    ["/teach/sales", "Go to student area", "/learn", "Teacher area"],
    ["/account/payments", "Go to student area", "/learn", "Teacher area"],
    ["/learn", "Go to teacher area", "/teach", "Student area"],
    ["/learn/messages", "Go to teacher area", "/teach", "Student area"],
  ])("em %s: '%s' leva para %s na mesma aba", (pathname, label, href, side) => {
    mocks.pathname = pathname;
    const { container } = render(<PlatformHeader />);

    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", href);
    expect(link).not.toHaveAttribute("target");
    // O celular mostra em que lado a pessoa esta (o caminho do topo nao cabe).
    expect(container.querySelector(".platform-topbar__side")).toHaveTextContent(side);
  });

  it("em espanhol", () => {
    mocks.pathname = "/teach";
    render(
      <I18nProvider initialLocale="es">
        <PlatformHeader />
      </I18nProvider>,
    );

    expect(screen.getByRole("link", { name: "Ir al área del alumno" })).toHaveAttribute("href", "/learn");
  });

  it("quem so estuda nao ve botao de troca, mas ve em que lado esta", () => {
    mocks.roles = ["student"];
    mocks.pathname = "/learn";
    const { container } = render(<PlatformHeader />);

    expect(screen.queryByRole("link", { name: /Go to (teacher|student) area/ })).toBeNull();
    expect(container.querySelector(".platform-topbar__side")).toHaveTextContent("Student area");
  });

  it("a barra lateral nao repete a troca: nem 'Teach' no rodape do aluno, nem 'My courses' no do professor", () => {
    mocks.pathname = "/learn";
    const { unmount } = render(<PlatformNav />);
    expect(document.querySelector('.platform-sidebar-nav a[href="/teach"]')).toBeNull();
    unmount();

    mocks.pathname = "/teach";
    render(<PlatformNav />);
    expect(document.querySelector('.platform-sidebar-nav a[href="/learn"]')).toBeNull();
  });
});

describe("Ajuda no topo", () => {
  it.each([
    ["/teach/sales", "My students"],
    ["/learn", "Private matter with the teacher"],
  ])("em %s o botao Ajuda abre as escolhas do lado (%s)", (pathname, choice) => {
    mocks.pathname = pathname;
    render(<PlatformHeader />);

    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog", { name: "What do you need help with?" })).toHaveTextContent(choice);
  });
});

describe("barra de baixo do celular: o atalho e sempre o OUTRO lado", () => {
  it.each([
    ["/teach", "Learn", "/learn"],
    ["/learn", "Teach", "/teach"],
  ])("em %s mostra '%s'", (pathname, label, href) => {
    mocks.pathname = pathname;
    render(<MobileSidebarDrawer open={false} onOpen={vi.fn()} onClose={vi.fn()} />);

    const bar = screen.getByRole("navigation", { name: "Mobile platform navigation" });
    const link = within(bar).getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", href);
    expect(link).not.toHaveAttribute("target");
  });
});
