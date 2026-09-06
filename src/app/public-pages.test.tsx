import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AboutPage from "@/app/about/page";
import ContactPage from "@/app/contact/page";
import HelpPage from "@/app/help/page";
import NotFound from "@/app/not-found";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

// Server component assíncrono (lê o idioma via next/headers); não é o que
// estes testes olham.
vi.mock("@/components/site/site-footer", () => ({
  SiteFooter: () => null,
}));

vi.mock("@/components/help/assistant-panel", () => ({
  AssistantPanel: () => null,
}));

vi.mock("@/components/help/help-center", () => ({
  HelpCenter: () => null,
}));

afterEach(cleanup);

describe("títulos do site público", () => {
  it("define .page-title como um clamp único no globals.css", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toMatch(
      /\.page-title\s*\{[^}]*font-size:\s*clamp\(1\.9rem,\s*6vw,\s*3\.5rem\)/,
    );
  });

  it.each([
    ["About", AboutPage],
    ["Contact", ContactPage],
    ["Help", HelpPage],
    ["404", NotFound],
  ])("%s: o h1 usa .page-title em vez de text-6xl fixo", async (_name, Page) => {
    render(Page === NotFound ? <NotFound /> : await Page());

    // 60px fixos estouravam a largura de um celular de 360px.
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveClass("page-title");
    expect(title.className).not.toMatch(/text-(5|6)xl/);
  });
});

describe("página 404", () => {
  it("manda para o catálogo, não para a vitrine interna /platform", () => {
    render(<NotFound />);

    expect(screen.getByRole("link", { name: "Browse courses" })).toHaveAttribute(
      "href",
      "/courses",
    );
    expect(
      screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/platform"),
    ).toBe(false);
  });
});

describe("caminho de suporte sem login", () => {
  // /support exige conta: para um visitante, "Contact support" era uma tela
  // de login sem aviso. O e-mail vira o caminho principal e o ticket é
  // anunciado como o que é.
  it("Help: e-mail como botão principal, ticket só para quem tem conta", async () => {
    render(await HelpPage());

    expect(screen.getByRole("link", { name: "Email support" })).toHaveAttribute(
      "href",
      "mailto:support@skillsetmind.com?subject=Support",
    );
    expect(
      screen.getByRole("link", { name: "Have an account? Open a ticket" }),
    ).toHaveAttribute("href", "/support");
    expect(
      screen.queryByRole("link", { name: "Contact support" }),
    ).not.toBeInTheDocument();
  });

  it("Contact: o cartão de suporte manda e-mail; o ticket fica dito para quem tem conta", async () => {
    render(await ContactPage());

    expect(screen.getByRole("link", { name: /Email support/ })).toHaveAttribute(
      "href",
      "mailto:support@skillsetmind.com?subject=Support",
    );
    expect(
      screen.getByRole("link", { name: "Open a tracked ticket" }),
    ).toHaveAttribute("href", "/support");
    expect(
      screen.queryByRole("link", { name: /Open a support ticket/ }),
    ).not.toBeInTheDocument();
  });
});
