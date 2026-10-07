import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformShell } from "@/components/platform/platform-shell";
import { parseSidebarPref, SIDEBAR_COOKIE, type SidebarPref } from "@/lib/ui/sidebar-cookie";
import { SidebarPreferenceProvider } from "@/lib/ui/sidebar-state";

// Onda E, parte 2: menu lateral recolhível no estilo da Hotmart. Aberto, ícone
// e nome; fechado, só o ícone, com o nome de dica no hover e no foco. A
// escolha fica num cookie que o servidor lê: o primeiro HTML já sai certo.

const mocks = vi.hoisted(() => ({ pathname: "/teach" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ user: { uid: "teacher-test", displayName: "Teacher", roles: ["teacher"] } }),
}));
vi.mock("./platform-header", () => ({ PlatformHeader: () => null }));
vi.mock("./status-banner", () => ({ StatusBanner: () => null }));
vi.mock("@/components/teacher/use-teacher-inbox-count", () => ({ useTeacherInboxCount: () => undefined }));

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");

function setCookie(pref: SidebarPref) {
  document.cookie = pref
    ? `${SIDEBAR_COOKIE}=${pref}; path=/`
    : `${SIDEBAR_COOKIE}=; max-age=0; path=/`;
}

/** Janela de `width` px para o `matchMedia` (o jsdom não avalia media query). */
function viewport(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const min = Number(query.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
    const below = Number(query.match(/width\s*<\s*(\d+)px/)?.[1] ?? Infinity);
    return {
      matches: width >= min && width < below,
      addEventListener() {},
      removeEventListener() {},
    };
  });
}

function shell(children: ReactNode = "Content") {
  return <PlatformShell title="Home">{children}</PlatformShell>;
}

function sidebar() {
  return document.querySelector(".platform-sidebar")!;
}

function toggleButton() {
  return screen.getByRole("button", { name: /^(Expand|Collapse) menu$/ });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCookie(null);
  mocks.pathname = "/teach";
});

describe("a escolha vem do cookie, lida no servidor", () => {
  function serverHtml(pref: SidebarPref) {
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      <SidebarPreferenceProvider value={pref}>{shell()}</SidebarPreferenceProvider>,
    );
    return host;
  }

  it("cookie 'collapsed': o primeiro HTML já sai recolhido, com o ☰ dizendo 'Expand menu'", () => {
    const html = serverHtml("collapsed");
    expect(html.querySelector(".platform-grid")).toHaveClass("platform-grid--collapsed");
    expect(html.querySelector(".platform-grid")).not.toHaveClass("platform-grid--auto");
    expect(html.querySelector(".platform-sidebar")).toHaveClass("sidebar-collapsed");
    const toggle = html.querySelector(".platform-sidebar-toggle")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-label", "Expand menu");
    // Recolhida, a linha do topo é só o ☰ (sem a marca larga).
    expect(html.querySelector(".platform-sidebar-brand__lockup-link")).toBeNull();
  });

  it("cookie 'expanded': aberto, sem depender da largura da tela", () => {
    const html = serverHtml("expanded");
    expect(html.querySelector(".platform-grid")!.className).not.toMatch(/platform-grid--(collapsed|auto)/);
    expect(html.querySelector(".platform-sidebar")).toHaveClass("sidebar-expanded");
    expect(html.querySelector(".platform-sidebar-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(html.querySelector(".platform-sidebar-brand__lockup-link")).not.toBeNull();
  });

  it("sem cookie: a grade sai 'auto' e o CSS decide a largura pela tela", () => {
    const html = serverHtml(null);
    expect(html.querySelector(".platform-grid")).toHaveClass("platform-grid--auto");
    expect(html.querySelector(".platform-grid")).not.toHaveClass("platform-grid--collapsed");
  });

  it("hidratar o HTML do servidor não troca nada (sem piscar, sem divergência)", async () => {
    setCookie("collapsed");
    const host = serverHtml("collapsed");
    document.body.appendChild(host);
    const before = host.innerHTML;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const mismatches = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(
        host,
        <SidebarPreferenceProvider value="collapsed">{shell()}</SidebarPreferenceProvider>,
        { onRecoverableError: mismatches },
      );
    });
    expect(mismatches).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelector(".platform-sidebar")).toHaveClass("sidebar-collapsed");
    expect(host.innerHTML).toBe(before);
    act(() => root!.unmount());
    host.remove();
  });

  it("o layout raiz lê o cookie e entrega ao provider; valor estranho vale como 'sem escolha'", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("parseSidebarPref(cookieStore.get(SIDEBAR_COOKIE)?.value)");
    expect(layout).toContain("<SidebarPreferenceProvider value={sidebarPref}>");
    expect(parseSidebarPref("collapsed")).toBe("collapsed");
    expect(parseSidebarPref("expanded")).toBe("expanded");
    expect(parseSidebarPref("open")).toBeNull();
    expect(parseSidebarPref(undefined)).toBeNull();
  });
});

describe("o botão ☰", () => {
  it("é um <button> de verdade com aria-expanded, aria-controls na lista e nome que diz o que faz", () => {
    render(shell());
    const toggle = toggleButton();
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAccessibleName("Collapse menu");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const nav = document.getElementById(toggle.getAttribute("aria-controls")!);
    expect(nav).toBe(screen.getByRole("navigation", { name: "Workspace" }));
    // No topo da barra, antes da lista (como na Hotmart), não no pé.
    expect(toggle.closest(".platform-sidebar-brand")).not.toBeNull();
    expect(toggle.compareDocumentPosition(nav!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("recolhe e abre, e grava a escolha no cookie (que o servidor lê na próxima carga)", () => {
    render(shell());
    fireEvent.click(toggleButton());
    expect(sidebar()).toHaveClass("sidebar-collapsed");
    expect(toggleButton()).toHaveAccessibleName("Expand menu");
    expect(toggleButton()).toHaveAttribute("aria-expanded", "false");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=collapsed`);

    fireEvent.click(toggleButton());
    expect(sidebar()).toHaveClass("sidebar-expanded");
    expect(document.cookie).toContain(`${SIDEBAR_COOKIE}=expanded`);
  });

  it("a escolha sobrevive à troca de página (cada página monta o seu shell)", () => {
    const first = render(shell());
    fireEvent.click(toggleButton());
    first.unmount();
    // O provider ainda tem o valor da primeira carga; o cookie é que vale.
    render(<SidebarPreferenceProvider value={null}>{shell()}</SidebarPreferenceProvider>);
    expect(sidebar()).toHaveClass("sidebar-collapsed");
  });

  it("em espanhol: 'Contraer menú' / 'Expandir menú'", () => {
    render(<I18nProvider initialLocale="es">{shell()}</I18nProvider>);
    const toggle = screen.getByRole("button", { name: "Contraer menú" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAccessibleName("Expandir menú");
  });

  it("o ícone é ☰ recolhido e vira seta aberto, só com transform", () => {
    expect(css).toMatch(
      /\.platform-sidebar:not\(\.sidebar-collapsed\) \.platform-menu-icon path:first-child \{\s*transform: translateY\(6px\) rotate\(-45deg\) scaleX\(0\.53\);/,
    );
    expect(css).toMatch(
      /\.platform-sidebar:not\(\.sidebar-collapsed\) \.platform-menu-icon path:last-child \{\s*transform: translateY\(-6px\) rotate\(45deg\) scaleX\(0\.53\);/,
    );
    render(shell());
    expect(toggleButton().querySelectorAll(".platform-menu-icon path")).toHaveLength(3);
  });
});

describe("recolhida: nome de dica no hover e no foco, e nome acessível", () => {
  it("cada item tem nome acessível e o rótulo no DOM; nenhum title (dica nativa dobrada)", () => {
    setCookie("collapsed");
    render(shell());
    expect(sidebar()).toHaveClass("sidebar-collapsed");
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    const items = within(nav).getAllByRole("link").concat(within(nav).getAllByRole("button"));
    expect(items.length).toBeGreaterThan(5);
    for (const item of items) {
      expect(item).not.toHaveAttribute("title");
      expect(item.querySelector(".platform-sidebar-label")?.textContent).toBeTruthy();
      expect(item).toHaveAccessibleName(/\S/);
    }
    expect(within(nav).getByRole("link", { name: "Students" })).toHaveAttribute("href", "/teach/students");
  });

  it("hover e foco dizem à dica onde ficar (--tip-x/--tip-y)", () => {
    setCookie("collapsed");
    render(shell());
    const students = screen.getByRole("link", { name: "Students" });
    fireEvent.mouseOver(students);
    expect(students.style.getPropertyValue("--tip-y")).toMatch(/^\d+px$/);
    const inbox = screen.getByRole("link", { name: "Inbox" });
    fireEvent.focus(inbox);
    expect(inbox.style.getPropertyValue("--tip-x")).toMatch(/^\d+px$/);
  });

  it("no CSS, a dica acende no hover E no foco do teclado, fixa (a lista rola) e só depois da medida", () => {
    const start = css.indexOf(".platform-sidebar.sidebar-collapsed .platform-nav-link[style]:is(:hover, :focus-visible) .platform-sidebar-label,");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain(".platform-sidebar .platform-sidebar-toggle[style]:is(:hover, :focus-visible) .platform-sidebar-label");
    expect(rule).toContain("position: fixed;");
    expect(rule).toContain("top: var(--tip-y);");
    expect(rule).toContain("left: var(--tip-x);");
    // Fora do hover/foco o rótulo continua no DOM (nome acessível), só recortado.
    expect(css).toMatch(
      /\.sidebar-collapsed \.platform-sidebar-label,\s*\.platform-sidebar-toggle \.platform-sidebar-label \{\s*position: absolute;\s*width: 1px;\s*height: 1px;\s*overflow: hidden;\s*clip-path: inset\(50%\);/,
    );
  });
});

describe("grupos e Ajuda com a barra recolhida", () => {
  it("no desktop, Promote recolhido abre a própria barra já no grupo", () => {
    viewport(1280);
    setCookie("collapsed");
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Open Promote navigation" }));
    expect(sidebar()).toHaveClass("sidebar-expanded");
    expect(screen.getByRole("button", { name: "Promote" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Media library" })).toHaveAttribute("href", "/teach/media");
  });

  it("na faixa média (1100px), Sales abre a gaveta no grupo, sem gravar escolha", () => {
    viewport(1100);
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Open Sales navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Platform navigation" });
    expect(within(drawer).getByRole("button", { name: "Sales" })).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("link", { name: "Subscriptions" })).toHaveAttribute("href", "/teach/subscriptions");
    expect(document.cookie).not.toContain(SIDEBAR_COOKIE);
  });

  it("uma Ajuda só, com nome, que abre as escolhas (gaveta no rail, barra no desktop)", () => {
    viewport(1100);
    const { unmount } = render(shell());
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    expect(within(nav).getAllByRole("button", { name: "Help" })).toHaveLength(1);
    fireEvent.click(within(nav).getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog", { name: "What do you need help with?" })).toBeInTheDocument();
    unmount();

    viewport(1280);
    setCookie("collapsed");
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(sidebar()).toHaveClass("sidebar-expanded");
    expect(screen.getByRole("dialog", { name: "What do you need help with?" })).toBeInTheDocument();
  });
});

describe("telas médias: o rail é o padrão", () => {
  it.each([
    [1100, null, "sidebar-collapsed"],
    [1100, "expanded", "sidebar-expanded"],
    [1179, null, "sidebar-collapsed"],
    [900, "expanded", "sidebar-collapsed"],
    [1180, null, "sidebar-expanded"],
    [1180, "collapsed", "sidebar-collapsed"],
  ] as const)("em %ipx com escolha %s: %s", (width, pref, expected) => {
    viewport(width);
    setCookie(pref);
    render(shell());
    expect(sidebar()).toHaveClass(expected);
  });

  it("no CSS, sem escolha salva a coluna é o rail de 64px de 768 a 1179px já no 1º quadro", () => {
    const start = css.indexOf("@media (min-width: 768px) and (width < 1180px) {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("\n}\n", start));
    expect(block).toMatch(/\.platform-grid--auto \{\s*--platform-sidebar-width: 64px;/);
    // O que não cabe em 64px some até o JS montar.
    expect(block).toContain(".platform-sidebar-brand__lockup-link");
    expect(block).toContain(".platform-nav-section-items");
  });
});

describe("movimento leve, e nenhum com 'reduzir movimento'", () => {
  const blocks = (() => {
    const ranges: string[] = [];
    const opener = "@media (prefers-reduced-motion: no-preference) {";
    for (let at = css.indexOf(opener); at !== -1; at = css.indexOf(opener, at + 1)) {
      let depth = 0;
      let end = css.indexOf("{", at);
      for (; end < css.length; end += 1) {
        if (css[end] === "{") depth += 1;
        if (css[end] === "}" && --depth === 0) break;
      }
      ranges.push(css.slice(at, end));
    }
    return ranges;
  })();
  const noPreference = blocks.join("\n");

  it("a largura troca na hora: nem a grade nem o painel animam layout", () => {
    expect(css).not.toMatch(/transition: grid-template-columns/);
    expect(css).not.toMatch(/\.platform-sidebar-panel \{[^}]*transition: width/);
  });

  it("o nome acende e o ☰ gira em 180ms, só dentro de no-preference e com os tokens", () => {
    expect(noPreference).toMatch(/\.platform-sidebar-label \{\s*transition: opacity var\(--duration-base\) var\(--ease-standard\);/);
    expect(noPreference).toMatch(/\.platform-menu-icon path \{\s*transition: transform var\(--duration-base\) var\(--ease-standard\);/);
    expect(css).toContain("--duration-base: 180ms;");
    // Fora de no-preference, nenhuma transição no rótulo nem no ícone.
    const outside = blocks.reduce((rest, block) => rest.replace(block, ""), css);
    expect(outside).not.toMatch(/\.platform-sidebar-label \{[^}]*transition/);
    expect(outside).not.toMatch(/\.platform-menu-icon path \{[^}]*transition/);
  });
});
