import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformNav } from "@/components/platform/platform-nav";

// Quem e criador e caia no /learn nao tinha como voltar ao painel do criador
// pela barra: LEARN + ACCOUNT + Marketplace, e nada mais. O caminho de volta so
// existia no menu do avatar, na URL, ou na gaveta de celular. A barra do Teach
// ja fazia o inverso ("My courses" no rodape) — este e o espelho dela.

const mocks = vi.hoisted(() => ({
  pathname: "/learn",
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
  mocks.pathname = "/learn";
  mocks.roles = ["teacher"];
});

describe("atalho Teach no rodape da barra do aluno", () => {
  it("quem tem acesso ao estudio ve o atalho no rodape, ao lado do Marketplace", () => {
    render(<PlatformNav />);

    const teach = screen.getByRole("link", { name: "Teach" });
    expect(teach).toHaveAttribute("href", "/teach");

    // Rodape, e nao no meio das aulas: mesmo bloco do Marketplace.
    const footer = teach.closest(".platform-nav-footer");
    expect(footer).not.toBeNull();
    expect(
      within(footer as HTMLElement).getByRole("link", { name: "Marketplace" }),
    ).toBeInTheDocument();

    // Vem ANTES do Marketplace, como "My courses" vem no rodape do Teach.
    const footerLinks = within(footer as HTMLElement)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(footerLinks).toEqual(["/teach", "/courses"]);
  });

  it("quem so estuda nao ve atalho nenhum para o estudio", () => {
    mocks.roles = ["student"];
    render(<PlatformNav />);

    expect(screen.queryByRole("link", { name: "Teach" })).toBeNull();
    expect(screen.queryByRole("link", { name: /\/teach/ })).toBeNull();
    // A barra do aluno continua inteira.
    expect(screen.getByRole("link", { name: "Marketplace" })).toBeInTheDocument();
  });

  it("dentro do proprio estudio o atalho nao se repete", () => {
    mocks.pathname = "/teach";
    render(<PlatformNav />);

    // No contexto do professor "/teach" e a Home; o atalho do aluno nao entra.
    expect(screen.queryByRole("link", { name: "Teach" })).toBeNull();
    expect(screen.getByRole("link", { name: "My courses" })).toHaveAttribute(
      "href",
      "/learn",
    );
  });

  it("em espanhol o rotulo sai traduzido (mesma chave da gaveta de celular)", () => {
    render(
      <I18nProvider initialLocale="es">
        <PlatformNav />
      </I18nProvider>,
    );

    expect(screen.getByRole("link", { name: "Enseñar" })).toHaveAttribute(
      "href",
      "/teach",
    );
    expect(screen.queryByRole("link", { name: "Teach" })).toBeNull();
  });

  it("recolhida, o icone leva a dica com o nome (regra do rail)", () => {
    render(<PlatformNav collapsed />);

    expect(screen.getByRole("link", { name: "Teach" })).toHaveAttribute(
      "title",
      "Teach",
    );
  });
});
