import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformNav } from "@/components/platform/platform-nav";

// Os grupos da barra lateral ("Products", "Sales"...) saiam em ingles cru em
// toda lingua, e a dica do icone recolhido ("Open Products navigation") era
// montada a mao. Agora os dois passam pelo dicionario (platform.navSection.*).

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

describe("grupos da barra lateral traduzidos", () => {
  it("em espanhol, o grupo e a dica do icone recolhido saem em espanhol", () => {
    render(
      <I18nProvider initialLocale="es">
        <PlatformNav collapsed />
      </I18nProvider>,
    );

    const products = screen.getByRole("button", { name: "Abrir navegación de Productos" });
    expect(products).toHaveAttribute("title", "Productos");
    expect(screen.queryByRole("button", { name: /Open Products navigation/ })).toBeNull();
  });

  it("expandida, o rotulo do grupo vem do dicionario", () => {
    render(
      <I18nProvider initialLocale="es">
        <PlatformNav />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Productos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ventas" })).toBeInTheDocument();
    expect(screen.queryByText("Products")).toBeNull();
  });

  it("sem provider cai no ingles, com a dica montada pelo dicionario", () => {
    render(<PlatformNav collapsed />);

    expect(
      screen.getByRole("button", { name: "Open Products navigation" }),
    ).toHaveAttribute("title", "Products");
  });
});

describe("Conta > Planos acende na barra do aluno", () => {
  it("/account/plans marca Plans & fees como pagina atual (antes: contexts vazio, nada aceso)", () => {
    mocks.roles = ["student"];
    mocks.pathname = "/account/plans";
    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "Plans & fees" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
