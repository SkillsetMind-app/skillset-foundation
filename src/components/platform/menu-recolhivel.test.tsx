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
import { SidebarPreferenceProvider } from "@/lib/ui/sidebar-preference";

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

  it("só as áreas logadas leem o cookie; valor estranho vale como 'sem escolha'", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    // O layout raiz envolve a home e as páginas públicas: nada da barra nele.
    const root = read("src/app/layout.tsx");
    expect(root).not.toMatch(/@\/lib\/ui\/sidebar|sidebar-preference|SidebarPreference/);
    expect(read("src/components/platform/sidebar-preference-layout.tsx")).toContain(
      "parseSidebarPref((await cookies()).get(SIDEBAR_COOKIE)?.value)",
    );
    for (const area of ["account", "learn", "ops", "support", "teach"]) {
      expect(read(`src/app/${area}/layout.tsx`), area).toContain("@/components/platform/sidebar-preference-layout");
    }
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

// ─── Segunda rodada: consertos da revisão do PR ─────────────────────────────

const MEDIUM = "(min-width: 768px) and (width < 1180px)";
const TABLET = "(min-width: 768px) and (width < 1024px)";

function mediaBlock(query: string) {
  const start = css.indexOf(`@media ${query} {`);
  expect(start, query).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}\n", start));
}

/** O corpo `{ ... }` da regra com exatamente este seletor, dentro de `scope`. */
function ruleBody(scope: string, selector: string) {
  const at = scope.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  return scope.slice(scope.indexOf("{", at), scope.indexOf("}", at) + 1);
}

function serverRender(pref: SidebarPref) {
  const host = document.createElement("div");
  host.innerHTML = renderToString(
    <SidebarPreferenceProvider value={pref}>{shell()}</SidebarPreferenceProvider>,
  );
  return host;
}

describe("tablet: a marca volta ao topo do rail", () => {
  it("recolhida, a linha do topo tem o ☰ e a marca pequena, que leva à home sem pré-carga", () => {
    const html = serverRender("collapsed");
    const brand = html.querySelector(".platform-sidebar-brand")!;
    const mark = brand.querySelector("a.platform-sidebar-brand__mark")!;
    expect(mark).toHaveAttribute("href", "/teach");
    expect(mark).toHaveAccessibleName("SkillsetMind");
    for (const img of mark.querySelectorAll("img")) expect(img).toHaveAttribute("loading", "lazy");
    expect(brand.querySelector(".platform-sidebar-toggle")).not.toBeNull();
    expect(brand.querySelector(".platform-sidebar-brand__lockup-link")).toBeNull();
  });

  it("sem escolha salva a marca pequena já vem no HTML do servidor (1º quadro do tablet); aberta por escolha, não", () => {
    expect(serverRender(null).querySelector(".platform-sidebar-brand__mark")).not.toBeNull();
    expect(serverRender("expanded").querySelector(".platform-sidebar-brand__mark")).toBeNull();
  });

  it("no CSS, a marca só aparece de 768 a 1023px, onde o ☰ some: os dois nunca dividem a linha", () => {
    expect(css).toMatch(/\n\.platform-sidebar-brand__mark \{\s*display: none;\s*\}/);
    expect(css).toMatch(/\n\.platform-sidebar-brand__mark img \{\s*width: 2rem;\s*height: 2rem;\s*\}/);
    const tablet = mediaBlock(TABLET);
    expect(ruleBody(tablet, "  .platform-sidebar-brand__mark")).toMatch(/display: inline-flex;/);
    expect(ruleBody(tablet, "  .platform-sidebar .platform-sidebar-toggle")).toMatch(/display: none;/);
    // Em nenhum outro lugar a marca acende (acima de 1023px o ☰ ocupa a linha).
    expect(css.match(/\.platform-sidebar-brand__mark \{/g)).toHaveLength(2);
  });
});

describe("1024–1179px sem escolha: o 1º quadro já é o rail que o JS desenha", () => {
  const auto = ".platform-grid--auto:not(.platform-grid--collapsed)";

  it("ativo em quadrado branco de 44px, ícones sem caixinha, sem filete e calha da rolagem reservada", () => {
    const medium = mediaBlock(MEDIUM);
    const active = ruleBody(medium, `  ${auto} .platform-nav-link:is(.platform-nav-active, .platform-nav-section-active)`);
    expect(active).toMatch(/width: 44px;/);
    expect(active).toMatch(/margin-inline: auto;/);
    expect(active).toMatch(/background: #ffffff !important;/);
    expect(ruleBody(medium, `  ${auto} .platform-nav-link:is(.platform-nav-active, .platform-nav-section-active) svg`))
      .toMatch(/color: #102a43 !important;/);
    expect(ruleBody(medium, `  ${auto} .platform-nav-active::before`)).toMatch(/content: none;/);
    const chip = ruleBody(medium, `  ${auto} .platform-nav-icon-chip`);
    expect(chip).toMatch(/background: transparent !important;/);
    expect(chip).toMatch(/box-shadow: none !important;/);
    expect(ruleBody(medium, `  ${auto} .platform-sidebar-nav`)).toMatch(/scrollbar-gutter: stable;/);
  });

  it("é o mesmo desenho do rail recolhido, e vence o gatilho ativo (mesma especificidade, vem depois)", () => {
    expect(css).toMatch(/\.platform-sidebar\.sidebar-collapsed \.platform-nav-link\.platform-nav-active \{\s*background: #ffffff !important;/);
    expect(css).toMatch(/\.platform-sidebar\.sidebar-collapsed \.platform-sidebar-nav \{[^}]*scrollbar-gutter: stable;/);
    expect(css.indexOf(`${auto} .platform-nav-link:is(.platform-nav-active`)).toBeGreaterThan(
      css.indexOf(".platform-sidebar .platform-nav-link.platform-nav-section-trigger.platform-nav-section-active"),
    );
  });
});

describe("tablet com o cookie 'expanded': o HTML do servidor já é o rail", () => {
  // As regras da faixa média valem, no tablet, para QUALQUER grade não
  // recolhida — não só sem cookie. Mesmo corpo, seletor mais largo.
  const suffixes = [
    " .platform-sidebar-panel",
    " :is(.platform-nav-section-items, .platform-nav-section-chevron, .platform-sidebar-brand__lockup-link)",
    " :is(.platform-sidebar-brand, .platform-nav-link)",
    " :is(.platform-nav-section, .platform-nav-footer)",
    " .platform-sidebar-nav",
    " .platform-nav-icon-chip",
    " .platform-nav-link:is(.platform-nav-active, .platform-nav-section-active)",
    " .platform-nav-link:is(.platform-nav-active, .platform-nav-section-active) svg",
    " .platform-nav-active::before",
  ];

  it.each(suffixes)("%s: mesma regra da faixa média, para .platform-grid:not(.platform-grid--collapsed)", (suffix) => {
    const medium = ruleBody(mediaBlock(MEDIUM), `  .platform-grid--auto:not(.platform-grid--collapsed)${suffix}`);
    const tablet = ruleBody(mediaBlock(TABLET), `  .platform-grid:not(.platform-grid--collapsed)${suffix}`);
    expect(tablet).toBe(medium);
  });

  it("a marca larga e os itens dos grupos somem: nada vaza por cima da barra do topo", () => {
    const hide = ruleBody(
      mediaBlock(TABLET),
      "  .platform-grid:not(.platform-grid--collapsed) :is(.platform-nav-section-items, .platform-nav-section-chevron, .platform-sidebar-brand__lockup-link)",
    );
    expect(hide).toMatch(/display: none;/);
    // E o servidor manda mesmo a marca larga nesse caso (é o que precisava sumir).
    expect(serverRender("expanded").querySelector(".platform-sidebar-brand__lockup-link")).not.toBeNull();
  });
});

describe("a dica do rail: uma por vez, e some quando a lista rola", () => {
  function tipped() {
    return sidebar().querySelectorAll(".platform-nav-link[style]");
  }

  it("o mouse num item apaga a dica do item com foco do teclado (e vice-versa)", () => {
    setCookie("collapsed");
    render(shell());
    const students = screen.getByRole("link", { name: "Students" });
    const inbox = screen.getByRole("link", { name: "Inbox" });
    fireEvent.focus(inbox);
    expect(inbox).toHaveAttribute("style");
    fireEvent.mouseOver(students);
    expect(students).toHaveAttribute("style");
    expect(inbox).not.toHaveAttribute("style");
    expect(tipped()).toHaveLength(1);
    fireEvent.focus(inbox);
    expect(students).not.toHaveAttribute("style");
    expect(tipped()).toHaveLength(1);
  });

  it("rolar a lista apaga a dica (ela ficaria parada no lugar velho)", () => {
    setCookie("collapsed");
    render(shell());
    fireEvent.mouseOver(screen.getByRole("link", { name: "Students" }));
    expect(tipped()).toHaveLength(1);
    fireEvent.scroll(screen.getByRole("navigation", { name: "Workspace" }));
    expect(tipped()).toHaveLength(0);
  });

  it("aberta, passar o mouse num item não mede nada; só o ☰ (a única dica aberta) mede", () => {
    render(shell());
    expect(sidebar()).toHaveClass("sidebar-expanded");
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    for (const item of within(nav).getAllByRole("link")) {
      fireEvent.mouseOver(item);
      fireEvent.focus(item);
    }
    expect(tipped()).toHaveLength(0);
    fireEvent.mouseOver(toggleButton());
    expect(toggleButton().style.getPropertyValue("--tip-x")).toMatch(/^\d+px$/);
  });
});

describe("a Ajuda do rail depois da gaveta", () => {
  it("fechar a gaveta não deixa a Ajuda do rail dizendo 'expandida'", () => {
    viewport(1100);
    render(shell());
    const help = within(sidebar() as HTMLElement).getByRole("button", { name: "Help" });
    fireEvent.click(help);
    const drawer = screen.getByRole("dialog", { name: "Platform navigation" });
    expect(within(drawer).getByRole("dialog", { name: "What do you need help with?" })).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "Close navigation" }));
    expect(screen.queryByRole("dialog", { name: "Platform navigation" })).toBeNull();
    expect(help).toHaveAttribute("aria-expanded", "false");
  });
});

describe("a chave velha do localStorage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("é apagada quando o módulo da barra chega ao navegador", async () => {
    localStorage.setItem("skillset_sidebar_state", "collapsed");
    vi.resetModules();
    const fresh = await import("@/lib/ui/sidebar-state");
    expect(fresh.LEGACY_SIDEBAR_KEY).toBe("skillset_sidebar_state");
    expect(localStorage.getItem("skillset_sidebar_state")).toBeNull();
  });

  it("armazenamento bloqueado não derruba a página", async () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.resetModules();
    await expect(import("@/lib/ui/sidebar-state")).resolves.toHaveProperty("useSidebarState");
  });
});
