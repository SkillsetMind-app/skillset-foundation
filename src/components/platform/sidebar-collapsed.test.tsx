import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformNav } from "@/components/platform/platform-nav";
import { SidebarToggle } from "@/components/platform/sidebar-toggle";

// Barra lateral recolhida: os icones perdiam o nome (so os grupos tinham dica),
// "Operations" era um grupo com um unico item de mesmo nome, e o botao de
// expandir ficava solto na borda, em cima da linha entre barra e conteudo.

const mocks = vi.hoisted(() => ({
  pathname: "/ops",
  roles: ["admin"] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "admin-1",
      email: "admin@example.com",
      displayName: "Admin",
      emailVerified: true,
      photoURL: null,
      roles: mocks.roles,
    },
  }),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    // Chave -> ultimo segmento, o bastante para o teste ler os rotulos.
    t: (key: string) => key.split(".").at(-1) ?? key,
  }),
}));

describe("barra lateral recolhida", () => {
  beforeEach(() => {
    mocks.pathname = "/ops";
    mocks.roles = ["admin"];
  });

  it("da nome a cada icone recolhido (title) e nao mostra dica quando expandida", () => {
    const { unmount } = render(<PlatformNav collapsed />);

    const collapsedLinks = screen.getAllByRole("link");
    expect(collapsedLinks.length).toBeGreaterThan(0);
    for (const link of collapsedLinks) {
      expect(link).toHaveAttribute("title");
      expect(link.getAttribute("title")).not.toBe("");
    }

    unmount();
    render(<PlatformNav collapsed={false} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("title");
    }
  });

  it("'Operations' e um item direto, nao um grupo de um item so com o mesmo nome", () => {
    render(<PlatformNav />);

    // Item direto = link para /ops; grupo = botao "Operations" com chevron.
    expect(screen.getByRole("link", { name: /operations/i })).toHaveAttribute(
      "href",
      "/ops",
    );
    expect(
      screen.queryByRole("button", { name: /operations/i }),
    ).not.toBeInTheDocument();
  });
});

// Itens extra da onda 3 (capturas do Patrick, 02/09): no rail, o gatilho de
// grupo (Sales, Products...) acendia em DUAS camadas no hover — o fundo do
// item, largo como o rail e cortado nas laterais, mais o chip do icone por
// dentro — enquanto o link direto (Earnings) acendia numa so. Agora os dois
// sao o mesmo quadrado de 44px, centrado nos 64px, sem chip.
describe("rail recolhido: um quadrado por item, sem chip e sem corte", () => {
  it("gatilho de grupo e link direto tem a mesma estrutura: o icone direto, sem chip", () => {
    mocks.roles = ["teacher"];
    mocks.pathname = "/teach/builder";
    const { container, unmount } = render(<PlatformNav collapsed />);

    expect(container.querySelectorAll(".platform-nav-icon-chip")).toHaveLength(0);
    const items = [...container.querySelectorAll("a, button")];
    expect(items.length).toBeGreaterThan(3);
    expect(items.some((item) => item.classList.contains("platform-nav-section-trigger"))).toBe(true);
    for (const item of items) {
      expect(item.firstElementChild?.tagName.toLowerCase(), item.className).toBe("svg");
    }

    // Expandida, o chip continua (alinha icone e rotulo).
    unmount();
    render(<PlatformNav />);
    expect(document.querySelectorAll(".platform-nav-icon-chip").length).toBeGreaterThan(3);
  });

  it("no CSS, o item do rail e um quadrado de 44px centrado, e a regra vem depois da do gatilho", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const rail = ".platform-sidebar.sidebar-collapsed .platform-nav-link {";
    const start = css.indexOf(rail);
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("\n}", start));
    expect(block).toContain("width: 44px");
    expect(block).toContain("height: 44px");
    expect(block).toContain("margin-inline: auto");
    expect(block).toContain("padding: 0 !important");

    // Hover do gatilho e hover do rail empatam em especificidade (0,4,0):
    // o do rail so ganha por vir DEPOIS. Antes disso era a segunda camada.
    const triggerHover = css.indexOf(".platform-sidebar .platform-nav-link.platform-nav-section-trigger:hover");
    const railHover = css.indexOf(".platform-sidebar.sidebar-collapsed .platform-nav-link:hover {");
    expect(triggerHover).toBeGreaterThan(-1);
    expect(railHover).toBeGreaterThan(triggerHover);

    // O destaque nao mora mais no chip.
    expect(css).not.toMatch(/\.sidebar-collapsed[^{]*\.platform-nav-icon-chip[^{]*\{[^}]*background: (?!transparent)/);
  });
});

describe("o botao de recolher/expandir", () => {
  it("e um item da barra (mesma classe dos links, alvo de 44px), nao um circulo na borda", () => {
    render(
      <SidebarToggle state="collapsed" isCollapsed onToggle={() => {}} />,
    );

    const button = screen.getByRole("button", { name: "expandSidebar" });
    expect(button.className).toMatch(/\bplatform-nav-link\b/);
    expect(button.className).toMatch(/\bplatform-sidebar-toggle\b/);
    expect(button.className).toMatch(/\bmin-h-11\b/);
  });

  it("fica por ultimo dentro da barra, e o CSS nao o pendura mais na borda", () => {
    const shell = readFileSync(
      path.join(process.cwd(), "src/components/platform/platform-shell.tsx"),
      "utf8",
    );
    const css = readFileSync(
      path.join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    // Na ordem do JSX: PlatformNav vem antes de SidebarToggle.
    expect(shell.indexOf("<PlatformNav")).toBeLessThan(
      shell.indexOf("<SidebarToggle"),
    );
    // As regras antigas selecionavam o botao pelo aria-label e o pregavam na
    // borda (position: absolute; right: -1.1rem). Sumiram.
    expect(css).not.toMatch(/button\[aria-label="(Expand|Collapse) sidebar"\]/);
    expect(css).toContain(".platform-sidebar .platform-sidebar-toggle");
  });
});
