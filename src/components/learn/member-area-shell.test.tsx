import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberAreaShell } from "@/components/learn/member-area-shell";

// O sino precisa da assinatura de notificações; o que ele faz na casca está
// provado em member-area-bell.test.tsx. Aqui só o shell.
vi.mock("@/components/platform/notification-bell", () => ({
  NotificationBell: () => null,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "student-1",
      email: "student@example.com",
      displayName: "Student",
      emailVerified: true,
      photoURL: null,
      roles: ["student"],
    },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: () => () => {},
}));

describe("MemberAreaShell", () => {
  it("puts the members theme on its own root so the --ma-* tokens cover the page", () => {
    const { container } = render(
      <MemberAreaShell theme="dark">
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(
      container.querySelector('[data-members-theme="dark"]'),
    ).not.toBeNull();
  });

  it.each([
    ["dark", "logo-wordmark__themed--dark"],
    ["light", "logo-wordmark__themed--light"],
  ] as const)(
    "o logo segue o tema do curso (%s), não o tema do app",
    (theme, tone) => {
      // O --ma-bg-top do curso escuro é quase preto mesmo com o app no tema
      // claro: o logo "auto" seguia o <html> e saía azul-marinho no escuro.
      const { container } = render(
        <MemberAreaShell theme={theme}>
          <p>Lesson</p>
        </MemberAreaShell>,
      );

      expect(container.querySelector(`header .${tone}`)).not.toBeNull();
    },
  );

  it("shows the teacher's mark, with no link to our public home, when the teacher is branded", () => {
    const { container } = render(
      <MemberAreaShell brand={{ name: "Atelier Curie" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(screen.getByText("Atelier Curie")).toBeInTheDocument();
    expect(screen.queryByText("Exit to dashboard")).toBeNull();
    expect(container.querySelector('a[href="/"]')).toBeNull();
  });

  it("o nome da marca do professor nao usa a serifa de display", () => {
    // Cormorant e uma serifa de DISPLAY: em 18px, na barra de cima, ela some.
    const { container } = render(
      <MemberAreaShell brand={{ name: "Atelier Curie" }}>
        <p>content</p>
      </MemberAreaShell>,
    );

    const name = container.querySelector("header span");
    expect(name).toHaveTextContent("Atelier Curie");
    expect(name).not.toHaveClass("display-title");
    expect(name?.className).toContain("font-semibold");
  });

  it("only lets a sanitized hex accent reach the CSS custom property", () => {
    const { container, rerender } = render(
      <MemberAreaShell brand={{ name: "Atelier", accentColor: "#123456" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    const root = () =>
      container.querySelector<HTMLElement>("[data-members-theme]");

    expect(root()?.style.getPropertyValue("--ma-accent")).toBe("#123456");

    rerender(
      <MemberAreaShell brand={{ name: "Atelier", accentColor: "javascript:x" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(root()?.style.getPropertyValue("--ma-accent")).toBe("");
  });

  it("pairs the teacher accent with a text colour that reads on it", () => {
    const { container } = render(
      <MemberAreaShell brand={{ name: "Atelier", accentColor: "#f5c518" }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    const style = container.querySelector<HTMLElement>("[data-members-theme]")?.style;

    // Branco fixo em cima desse amarelo dava 1,6:1.
    expect(style?.getPropertyValue("--ma-on-accent")).toBe("#0a0d12");
    // O hover nao pode voltar ao vermelho da plataforma com tinta escura em cima.
    expect(style?.getPropertyValue("--ma-accent-hover")).toBe("#f5c518");
  });

  // A sala nao tinha menu da conta nem Ajuda, e o logo levava para a home
  // publica. Agora: logo -> My courses; Ajuda e conta no topo, com ou sem a
  // marca do professor.
  it("o logo leva para My courses, nao para a home publica", () => {
    const { container } = render(
      <MemberAreaShell>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(container.querySelector('header a[href="/learn"]')).not.toBeNull();
    expect(container.querySelector('header a[href="/"]')).toBeNull();
  });

  it.each([
    ["sem marca", null],
    ["com a marca do professor", { name: "Atelier Curie" }],
  ])("tem Ajuda e menu da conta (%s)", (_label, brand) => {
    render(
      <MemberAreaShell brand={brand}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open account menu" })).toBeInTheDocument();
  });

  it.each([
    [true, "/learn/courses/curso-1/community"],
    [false, "/learn/courses/curso-1/messages"],
  ])("a duvida da aula vai para a comunidade do curso (comunidade ligada: %s)", (communityEnabled, href) => {
    render(
      <MemberAreaShell course={{ href: "/learn/courses/curso-1", communityEnabled }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const dialog = screen.getByRole("dialog", { name: "What do you need help with?" });
    expect(within(dialog).getByRole("link", { name: /Question about a lesson/ })).toHaveAttribute("href", href);
    expect(within(dialog).getByRole("link", { name: /Private matter with the teacher/ })).toHaveAttribute(
      "href",
      "/learn/courses/curso-1/messages",
    );
  });
});
