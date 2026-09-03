import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformNav } from "@/components/platform/platform-nav";
import { platformNav } from "@/data/site";

// A barra do professor eram OITO gavetas de acordeao, tres delas com um ou dois
// links: chegar em "Vendas" custava um clique para abrir e outro para ir, e com
// a gaveta fechada a pessoa nem sabia que a tela existia. Agora o trabalho do
// dia e uma lista plana; so Marketing e Ferramentas, que sao caudas longas,
// seguem em grupo. Marketplace e "o que eu estudo" foram para o pe da barra.

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
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
  }),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "platform.sidebarNavLabel": "Workspace",
        "platform.navSection.marketing": "Marketing",
        "platform.navSection.tools": "Tools",
        "platform.nav.studio": "Home",
        "platform.nav.courseBuilder": "My products",
        "platform.nav.membersArea": "Members & communities",
        "platform.nav.onlineEvents": "Online events",
        "platform.nav.sales": "Sales",
        "platform.nav.subscriptions": "Subscriptions",
        "platform.nav.earnings": "Earnings",
        "platform.nav.reports": "Reports",
        "platform.nav.marketplace": "Marketplace",
        "platform.nav.myCourses": "My courses",
        "platform.nav.coupons": "Coupons",
        "platform.nav.team": "Team",
      })[key] ?? key,
  }),
}));

afterEach(() => {
  cleanup();
  mocks.pathname = "/teach";
});

function itemsIn(section: string) {
  return platformNav
    .filter((item) => item.sectionKey === section && item.contexts.includes("teacher"))
    .map((item) => item.href);
}

describe("lista plana da barra do professor", () => {
  it("Produtos, Vendas, Assinaturas, Ganhos e Relatorios sao links diretos", () => {
    render(<PlatformNav />);

    const direct: Array<[string, string]> = [
      ["Home", "/teach"],
      ["My products", "/teach/builder"],
      ["Sales", "/teach/sales"],
      ["Subscriptions", "/teach/subscriptions"],
      ["Earnings", "/account/payments"],
      ["Reports", "/teach/reports"],
    ];

    for (const [label, href] of direct) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
      // Nenhum deles esconde a tela atras de um gatilho de grupo.
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });

  it("so Marketing e Ferramentas seguem como grupo", () => {
    render(<PlatformNav />);

    const triggers = screen
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());

    expect(triggers).toEqual(["Marketing", "Tools"]);
  });

  it("Marketplace e 'o que eu estudo' ficam no pe da barra", () => {
    render(<PlatformNav />);

    const footer = screen.getByRole("link", { name: "Marketplace" }).closest(
      ".platform-nav-footer",
    );

    expect(footer).not.toBeNull();
    expect(
      within(footer as HTMLElement).getByRole("link", { name: "My courses" }),
    ).toBeInTheDocument();
    // Ultimo bloco do <nav>: nada do trabalho do dia vem depois dele.
    expect(footer?.parentElement?.lastElementChild).toBe(footer);
  });
});

describe("o grupo Growth foi dissolvido item a item", () => {
  it("nao existe mais uma secao growth", () => {
    expect(platformNav.some((item) => item.sectionKey === "growth")).toBe(false);
  });

  it("Coupons virou promocao (Marketing) e Team virou acesso (Tools)", () => {
    expect(itemsIn("marketing")).toContain("/teach/coupons");
    expect(itemsIn("tools")).toContain("/teach/team");
  });

  it("os dois continuam alcancaveis pela barra, dentro do grupo novo", () => {
    mocks.pathname = "/teach/coupons";
    render(<PlatformNav />);

    expect(screen.getByRole("link", { name: "Coupons" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Marketing" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
