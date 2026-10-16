import { cleanup, render, screen, within } from "@testing-library/react";
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
    ["/teach", "Go to student area", "/learn", "Teacher"],
    ["/teach/sales", "Go to student area", "/learn", "Teacher"],
    ["/account/payments", "Go to student area", "/learn", "Teacher"],
    ["/learn", "Go to teacher area", "/teach", "Student"],
    ["/learn/messages", "Go to teacher area", "/teach", "Student"],
  ])("em %s: '%s' leva para %s na mesma aba", (pathname, label, href, side) => {
    mocks.pathname = pathname;
    const { container } = render(<PlatformHeader />);

    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", href);
    expect(link).not.toHaveAttribute("target");
    // Abaixo de 1280px so o icone aparece: o nome inteiro fica no aria-label
    // (leitor de tela), no title (dica do mouse) e no texto escondido.
    expect(link).toHaveAttribute("aria-label", label);
    expect(link).toHaveAttribute("title", label);
    expect(link.querySelector(".platform-topbar__switch-label")).toHaveTextContent(label);
    // O celular mostra em que lado a pessoa esta, numa palavra so.
    expect(container.querySelector(".platform-topbar__side")).toHaveTextContent(new RegExp(`^${side}$`));
  });

  it.each([
    ["/teach", "Ir al área del alumno", "/learn", "Profesor"],
    ["/learn", "Ir al área del profesor", "/teach", "Alumno"],
  ])("em espanhol, em %s: '%s' e o lado '%s'", (pathname, label, href, side) => {
    mocks.pathname = pathname;
    const { container } = render(
      <I18nProvider initialLocale="es">
        <PlatformHeader />
      </I18nProvider>,
    );

    expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    // "Área del alumno" e "Área del profesor" cortavam os dois em "ÁREA D…".
    expect(container.querySelector(".platform-topbar__side")).toHaveTextContent(new RegExp(`^${side}$`));
  });

  it("quem so estuda nao ve botao de troca, mas ve em que lado esta", () => {
    mocks.roles = ["student"];
    mocks.pathname = "/learn";
    const { container } = render(<PlatformHeader />);

    expect(screen.queryByRole("link", { name: /Go to (teacher|student) area/ })).toBeNull();
    expect(container.querySelector(".platform-topbar__side")).toHaveTextContent("Student");
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

// A Ajuda saiu do topo do estudio e da area do aluno: ela mora na barra
// lateral (no celular, na gaveta). Uma por tela — ver uma-ajuda-por-tela.test.
describe("o topo nao tem Ajuda", () => {
  it.each(["/teach/sales", "/learn", "/ops"])("em %s", (pathname) => {
    mocks.pathname = pathname;
    mocks.roles = pathname === "/ops" ? ["admin"] : ["teacher"];
    render(<PlatformHeader />);

    expect(within(screen.getByRole("banner")).queryByRole("button", { name: "Help" })).toBeNull();
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
