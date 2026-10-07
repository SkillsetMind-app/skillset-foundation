import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlatformNav } from "@/components/platform/platform-nav";

// Os menus por papel. O aluno via 10 links em dois grupos que abriam e
// fechavam (quem estava em "Learn" nao via "Messages"); o professor via 18
// links, com as mensagens dos alunos escondidas dentro de "Marketing" e tres
// itens que nao faziam nada. Agora: aluno com quatro itens fixos + Ajuda, e
// compras/configuracoes embaixo; professor com oito itens no primeiro nivel.

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
  roles: ["teacher"] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
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
  }),
}));

afterEach(() => {
  cleanup();
  mocks.pathname = "/teach";
  mocks.roles = ["teacher"];
});

/** O que a pessoa ve no primeiro nivel, em ordem: links diretos, gatilhos de
 *  grupo e o botao Ajuda. O rodape (Marketplace) fica de fora. */
function firstLevel() {
  const nav = screen.getByRole("navigation", { name: "Workspace" });
  return [...nav.querySelectorAll(":scope > .platform-nav-section")].flatMap((section) =>
    [...section.querySelectorAll(":scope > a, :scope > button, :scope > .help-menu > button")].map(
      (control) => control.textContent?.trim(),
    ),
  );
}

describe("barra do professor", () => {
  it("oito itens no primeiro nivel (mais Eventos dentro de Produtos), Ajuda por ultimo", () => {
    render(<PlatformNav />);

    expect(firstLevel()).toEqual([
      "Home",
      "My products",
      "Online events",
      "Students",
      "Inbox",
      "Sales",
      "Earnings",
      "Promote",
      "Help",
    ]);
  });

  it("os destinos diretos", () => {
    render(<PlatformNav />);

    for (const [label, href] of [
      ["Home", "/teach"],
      ["My products", "/teach/builder"],
      ["Students", "/teach/students"],
      ["Inbox", "/teach/messages"],
      ["Earnings", "/account/payments"],
    ]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("Vendas e Promover sao os dois unicos grupos", () => {
    render(<PlatformNav />);

    // Vendas e o primeiro grupo: vem aberto.
    const sales = screen.getByRole("button", { name: "Sales" });
    expect(sales).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Sales" })).toHaveAttribute("href", "/teach/sales");
    expect(screen.getByRole("link", { name: "Subscriptions" })).toHaveAttribute("href", "/teach/subscriptions");
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/teach/reports");

    const promote = screen.getByRole("button", { name: "Promote" });
    fireEvent.click(promote);
    expect(promote).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Marketing overview" })).toHaveAttribute("href", "/teach/marketing");
    expect(screen.getByRole("link", { name: "Storefront & pages" })).toHaveAttribute("href", "/teach/storefront");
    expect(screen.getByRole("link", { name: "Media library" })).toHaveAttribute("href", "/teach/media");
  });

  it("os itens que sairam: mortos, ferramentas (avatar) e o pulo para o lado do aluno (topo)", () => {
    render(<PlatformNav />);
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));

    for (const gone of [
      "Collaborators",
      "Integrations",
      "Coupons",
      "Verification",
      "Members & communities",
      "Messages",
      "My courses",
      "Plans & fees",
    ]) {
      expect(screen.queryByRole("link", { name: gone }), gone).toBeNull();
    }
  });

  it("o numero de pendentes aparece ao lado de Inbox", () => {
    render(<PlatformNav navigationCounts={{ "/teach/messages": 3 }} />);

    const inbox = screen.getByRole("link", { name: /Inbox/ });
    expect(inbox).toHaveAttribute("href", "/teach/messages");
    expect(inbox).toHaveTextContent("3");
  });

  it("Marketplace segue no pe da barra", () => {
    render(<PlatformNav />);

    const footer = screen.getByRole("link", { name: "Marketplace" }).closest(".platform-nav-footer");
    expect(footer).not.toBeNull();
    expect(within(footer as HTMLElement).getAllByRole("link")).toHaveLength(1);
  });
});

describe("barra do aluno", () => {
  it.each([
    ["so estuda", ["student"], ["My purchases", "/account/billing"]],
    ["tambem ensina", ["student", "teacher"], ["Billing", "/account/billing"]],
  ] as const)("quatro itens fixos, Ajuda, e embaixo compras e configuracoes (%s)", (_label, roles, purchases) => {
    mocks.roles = [...roles];
    mocks.pathname = "/learn";
    render(<PlatformNav />);

    expect(firstLevel()).toEqual([
      "My courses",
      "Messages",
      "Communities",
      "Certificates",
      "Help",
      purchases[0],
      "Settings",
    ]);
    expect(screen.getByRole("link", { name: "My courses" })).toHaveAttribute("href", "/learn");
    expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("href", "/learn/messages");
    expect(screen.getByRole("link", { name: "Communities" })).toHaveAttribute("href", "/learn/community");
    expect(screen.getByRole("link", { name: "Certificates" })).toHaveAttribute("href", "/learn/credentials");
    expect(screen.getByRole("link", { name: purchases[0] })).toHaveAttribute("href", purchases[1]);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/account");
  });

  it("sem planos de criador, sem 'Classroom' e sem pulo para o estudio na barra", () => {
    mocks.roles = ["student", "teacher"];
    mocks.pathname = "/learn";
    render(<PlatformNav />);

    expect(screen.queryByRole("link", { name: "Plans & fees" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Classroom" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Teach" })).toBeNull();
    expect(document.querySelector('a[href="/account/plans"]')).toBeNull();
    expect(document.querySelector('a[href="/teach"]')).toBeNull();
  });

  it("a Ajuda da barra abre as tres escolhas do aluno no lugar", () => {
    mocks.roles = ["student"];
    mocks.pathname = "/learn";
    render(<PlatformNav />);

    const help = screen.getByRole("button", { name: "Help" });
    fireEvent.click(help);

    expect(help).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog", { name: "What do you need help with?" });
    expect(within(dialog).getByRole("link", { name: /Question about a lesson/ })).toHaveAttribute("href", "/learn/community");
    expect(within(dialog).getByRole("link", { name: /Private matter with the teacher/ })).toHaveAttribute("href", "/learn/messages");
  });
});
