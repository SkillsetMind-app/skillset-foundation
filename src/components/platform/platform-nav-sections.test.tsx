import { readFileSync } from "node:fs";
import path from "node:path";

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

    const promote = screen.getByRole("button", { name: "Abrir navegación de Promocionar" });
    // A dica do icone recolhido e o proprio rotulo (CSS), nao um title.
    expect(promote.querySelector(".platform-sidebar-label")).toHaveTextContent("Promocionar");
    expect(promote).not.toHaveAttribute("title");
    expect(screen.queryByRole("button", { name: /Open Promote navigation/ })).toBeNull();
  });

  it("expandida, o rotulo do grupo vem do dicionario", () => {
    render(
      <I18nProvider initialLocale="es">
        <PlatformNav />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Promocionar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ayuda" })).toBeInTheDocument();
    expect(screen.queryByText("Promote")).toBeNull();
  });

  it("sem provider cai no ingles, com a dica montada pelo dicionario", () => {
    render(<PlatformNav collapsed />);

    expect(
      screen.getByRole("button", { name: "Open Promote navigation" }).querySelector(".platform-sidebar-label"),
    ).toHaveTextContent("Promote");
  });
});

describe("Planos de criador fora da barra lateral", () => {
  // Os planos sao de quem vende: o professor chega neles pelo "Creator plan"
  // do menu do avatar. Na barra, nem o professor que estuda os ve.
  it("o professor que estuda nao ve Plans & fees na barra", () => {
    mocks.roles = ["student", "teacher"];
    mocks.pathname = "/learn/messages";
    render(<PlatformNav />);

    expect(screen.queryByRole("link", { name: "Plans & fees" })).toBeNull();
  });
});

// O aluno via os planos de quem vende e uma pagina chamada "Billing" que so
// guarda o que ele comprou.
describe("Conta do aluno: compras, sem plano de criador", () => {
  it("o aluno ve My purchases e nenhum Plans & fees", () => {
    mocks.roles = ["student"];
    mocks.pathname = "/account/billing";
    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "My purchases" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Billing" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Plans & fees" })).toBeNull();
  });

  it("em espanhol, Mis compras", () => {
    mocks.roles = ["student"];
    mocks.pathname = "/learn/messages";
    render(
      <I18nProvider initialLocale="es">
        <PlatformNav />
      </I18nProvider>,
    );

    expect(screen.getByRole("link", { name: "Mis compras" })).toHaveAttribute("href", "/account/billing");
  });

  it("o professor que estuda segue vendo Billing", () => {
    mocks.roles = ["student", "teacher"];
    mocks.pathname = "/learn/messages";
    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute("href", "/account/billing");
    expect(screen.queryByRole("link", { name: "My purchases" })).toBeNull();
  });
});

// Sales e Promote pareciam titulos de secao (38px, 11,5px em MAIUSCULAS); na
// gaveta do celular tinham 30px e borda na cor do texto, e a pagina atual so
// ganhava um contorno claro.
describe("primeiro nivel: grupos com a mesma linha dos links, e a pagina atual a vista", () => {
  it("o grupo tem 44px, 14px e borda transparente; a pagina atual tem fundo na gaveta", () => {
    mocks.pathname = "/teach/sales";
    render(<PlatformNav />);

    const group = screen.getByRole("button", { name: "Promote" });
    expect(group).toHaveClass("h-11", "min-h-11", "px-2.5", "text-sm", "border-transparent");
    expect(group.querySelector(".platform-nav-icon-chip")).toBeInTheDocument();

    const current = document.querySelector('a[aria-current="page"]');
    expect(current).toHaveAttribute("href", "/teach/sales");
    // O fundo mais forte (o claro de antes perdia para o hover) e o filete.
    expect(current).toHaveClass(
      "bg-[var(--color-surface-strong)]",
      "text-[var(--color-primary)]",
      "before:bg-[var(--color-accent)]",
    );
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);

    // A Ajuda abre no lugar como os grupos: com a setinha.
    expect(screen.getByRole("button", { name: "Help" }).querySelector(".platform-nav-section-chevron")).toBeInTheDocument();
  });

  it("no CSS, o gatilho do grupo nao encolhe nem vira MAIUSCULAS", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).not.toMatch(/\.platform-nav-section-trigger \.platform-sidebar-label\s*\{[^}]*uppercase/);
    expect(css).not.toMatch(/\.platform-nav-section-trigger \.platform-nav-icon-chip\s*\{[^}]*28px/);
    const trigger = css.slice(css.indexOf(".platform-sidebar .platform-nav-link.platform-nav-section-trigger {"));
    expect(trigger.slice(0, trigger.indexOf("}"))).not.toMatch(/min-height|color: rgba/);
  });
});
