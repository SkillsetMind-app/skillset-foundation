import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberAreaShell } from "@/components/learn/member-area-shell";
import { PlatformShell } from "@/components/platform/platform-shell";

// Exatamente UMA Ajuda por tela. Antes eram ate tres iguais ao mesmo tempo
// (barra lateral, topo e menu do avatar), e para quem tem pouca pratica com
// computador dois botoes iguais parecem duas coisas diferentes.
//   - estudio e area do aluno: na barra lateral (no celular, na gaveta);
//   - sala de aula, que nao tem barra lateral: no topo, com o curso;
//   - operacoes: nenhuma.

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
  roles: ["teacher"] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "person-1",
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
vi.mock("@/components/platform/status-banner", () => ({ StatusBanner: () => null }));
vi.mock("@/components/shared/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/teacher/use-teacher-inbox-count", () => ({ useTeacherInboxCount: () => undefined }));
vi.mock("@/lib/data/user-profiles", () => ({ subscribeToUserProfile: () => () => {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  mocks.pathname = "/teach";
  mocks.roles = ["teacher"];
});

function helpTriggers() {
  return screen.queryAllByRole("button", { name: "Help" });
}

describe("uma Ajuda por tela", () => {
  it.each([
    ["estudio", "/teach/sales", ["teacher"], "My students"],
    ["area do aluno", "/learn", ["student"], "Private matter with the teacher"],
  ])("%s: so a da barra lateral, nem no topo nem no menu da conta", (_label, pathname, roles, choice) => {
    mocks.pathname = pathname;
    mocks.roles = roles;
    render(<PlatformShell title="Page">Content</PlatformShell>);

    expect(helpTriggers()).toHaveLength(1);
    const sidebar = screen.getByRole("navigation", { name: "Workspace" });
    const help = within(sidebar).getByRole("button", { name: "Help" });
    expect(within(screen.getByRole("banner")).queryByRole("button", { name: "Help" })).toBeNull();

    // Com o menu da conta aberto, continua uma so.
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(helpTriggers()).toHaveLength(1);

    fireEvent.click(help);
    expect(screen.getByRole("dialog", { name: "What do you need help with?" })).toHaveTextContent(choice);
  });

  it("operacoes: nenhuma Ajuda, e nunca as escolhas do aluno", () => {
    mocks.pathname = "/ops";
    mocks.roles = ["admin"];
    render(<PlatformShell title="Operations">Content</PlatformShell>);
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));

    expect(helpTriggers()).toHaveLength(0);
    expect(screen.queryByText("Question about a lesson")).toBeNull();
  });

  it.each([
    ["sem marca", null],
    ["com a marca do professor", { name: "Atelier Curie" }],
  ])("sala de aula (%s): so a do topo, com o curso da sala", (_label, brand) => {
    mocks.pathname = "/learn/courses/curso-1";
    mocks.roles = ["student"];
    render(
      <MemberAreaShell brand={brand} course={{ href: "/learn/courses/curso-1", communityEnabled: true }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));

    expect(helpTriggers()).toHaveLength(1);
    fireEvent.click(helpTriggers()[0]);
    expect(
      within(screen.getByRole("dialog", { name: "What do you need help with?" }))
        .getByRole("link", { name: /Question about a lesson/ }),
    ).toHaveAttribute("href", "/learn/courses/curso-1/community");
  });

  // Tablet: a barra e um trilho de icones; a Ajuda dele abre a gaveta ja na
  // Ajuda, com o foco dentro das escolhas.
  it("no trilho do tablet, a Ajuda abre a gaveta com o foco na primeira escolha", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("768px") && query.includes("1024px"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mocks.pathname = "/learn";
    mocks.roles = ["student"];
    render(<PlatformShell title="My courses">Content</PlatformShell>);

    expect(helpTriggers()).toHaveLength(1);
    fireEvent.click(helpTriggers()[0]);

    const choices = screen.getByRole("dialog", { name: "What do you need help with?" });
    const first = within(choices).getByRole("link", { name: /Question about a lesson/ });
    await waitFor(() => expect(first).toHaveFocus());
  });
});
