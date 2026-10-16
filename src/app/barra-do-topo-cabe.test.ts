import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";

/**
 * A barra do topo da plataforma tem `overflow: hidden` na coluna e um grupo de
 * acoes que nao encolhe. Se o que esta nela passa da largura, o que fica de
 * fora e justamente o fim do grupo: o idioma e o menu da conta (Sair,
 * Configuracoes). Foi o que a troca de lado com o texto inteiro ("Ir al área
 * del profesor") e uma segunda Ajuda fizeram de 768 a ~1180px.
 *
 * O jsdom nao mede layout, entao a folha de estilo e lida como texto e a conta
 * e feita aqui, com as larguras que a propria folha declara. O que nao esta na
 * folha (avatar, campo de busca no minimo, largura media de uma letra) vai como
 * constante com nome, puxada para o lado pior.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\r\n/g, "\n");

function mediaBlocks(condition: string): string[] {
  const blocks: string[] = [];
  const open = /@media([^{]*)\{/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(css)) !== null) {
    let depth = 1;
    let i = open.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      if (css[i] === "}") depth -= 1;
      i += 1;
    }
    if (match[1].replace(/\s+/g, " ").trim() === condition) blocks.push(css.slice(open.lastIndex, i));
  }
  return blocks;
}

/** Corpo da primeira regra com exatamente este seletor em `source`. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = source.match(new RegExp(`(?:^|[\\n}])\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(found, `regra ${selector} nao encontrada`).not.toBeNull();
  return found![1];
}

function prop(body: string, name: string): string {
  const found = body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`));
  expect(found, `${name} nao declarado`).not.toBeNull();
  return found![1].replace(/\s*!important/, "").trim();
}

function px(value: string, fontPx = 16): number {
  if (value.endsWith("rem")) return parseFloat(value) * 16;
  if (value.endsWith("em")) return parseFloat(value) * fontPx;
  if (value.endsWith("px")) return parseFloat(value);
  throw new Error(`unidade inesperada: ${value}`);
}

// Fora da folha (lado pior): avatar size-8, logo size-10, o campo de busca
// encolhido ate o minimo (lupa + dica do atalho + respiros), e a largura media
// de uma letra maiuscula em negrito.
const AVATAR = 32;
const LOGO = 40;
const SEARCH_MIN = 110;
const CAPS_EM = 0.74;
const TEXT_EM = 0.62;

const inner = rule(css, ".platform-topbar__inner");
const actions = rule(css, ".platform-topbar__actions");
// Os botoes de icone do grupo (tema, Advisor, sino, busca, idioma): 44px.
const iconButton = px(prop(
  css.match(/\.platform-topbar__actions > button:not\(\.locale-switcher-compact\):not\(\.account-menu-trigger\):not\(\.help-menu-trigger\)\s*\{([^}]*)\}/)![1],
  "width",
));
const innerGap = px(prop(inner, "gap"));
const innerPadding = px(prop(inner, "padding").split(/\s+/)[1]);
const actionsGap = px(prop(actions, "gap"));
const sidebar = px(css.match(/--sidebar-width:\s*([^;]+);/)![1]);
const rail = px(prop(rule(css, ".platform-grid--collapsed"), "--platform-sidebar-width"));
// Onda E: sem escolha salva, de 768 a 1179px a coluna e o rail ja no CSS.
const mediumRail = px(prop(
  rule(mediaBlocks("(min-width: 768px) and (width < 1180px)").join("\n"), ".platform-grid--auto"),
  "--platform-sidebar-width",
));

/** O menu da conta com nome: avatar, nome no maximo, seta e respiros. */
function accountTrigger(): number {
  const name = px(prop(rule(css, ".account-menu-trigger__name"), "max-width"));
  const gap = px(prop(rule(css, ".account-menu-trigger"), "gap"));
  return 6 + AVATAR + gap + name + gap + 12 + 14 + 2;
}

/** Troca de lado com o texto inteiro, no idioma em que ela e maior. */
function switchWithText(): number {
  const longest = Math.max(
    ...[en, es].flatMap((dict) => [dict.platform.side.goStudent, dict.platform.side.goTeacher].map((label) => label.length)),
  );
  return 14 + 16 + 6 + longest * 13 * TEXT_EM + 14 + 2;
}

/** Troca de lado + tema + Advisor + sino + conta + idioma: o grupo inteiro. */
function actionsWidth(switchWidth: number): number {
  const items = [switchWidth, iconButton, iconButton, iconButton, accountTrigger(), iconButton];
  return items.reduce((sum, width) => sum + width, 0) + actionsGap * (items.length - 1);
}

/** O que sobra para o grupo depois da barra lateral, dos respiros, do caminho
 *  (que encolhe ate zero) e da busca no minimo. */
function roomForActions(viewport: number, sidebarWidth: number): number {
  return viewport - sidebarWidth - innerPadding * 2 - innerGap * 2 - SEARCH_MIN;
}

describe("a barra do topo cabe de 768px para cima", () => {
  const below1280 = mediaBlocks("(max-width: 1279.98px)").join("\n");

  it("abaixo de 1280px a troca de lado fica so com o icone e o nome escondido para leitor de tela", () => {
    const button = rule(below1280, ".platform-topbar__switch");
    expect(px(prop(button, "width"))).toBe(iconButton);
    expect(prop(button, "padding")).toBe("0");

    const label = rule(below1280, ".platform-topbar__switch-label");
    expect(prop(label, "position")).toBe("absolute");
    expect(prop(label, "width")).toBe("1px");
    expect(prop(label, "clip")).toBe("rect(0 0 0 0)");
  });

  it("a Ajuda nao mora mais no topo da plataforma", () => {
    expect(css).not.toMatch(/\.platform-topbar__help\b/);
  });

  it.each([
    [768, "trilho, o padrao", mediumRail],
    [1023, "trilho, o padrao", mediumRail],
    [1024, "trilho, o padrao", mediumRail],
    [1179, "trilho, o padrao", mediumRail],
    [1024, "barra aberta por escolha", sidebar],
    [1179, "barra aberta por escolha", sidebar],
    [1180, "barra aberta, o padrao", sidebar],
    [1279, "barra aberta, o padrao", sidebar],
  ])("em %spx (%s), o grupo de acoes com a troca so de icone cabe", (viewport, _label, sidebarWidth) => {
    expect(actionsWidth(iconButton)).toBeLessThanOrEqual(roomForActions(viewport, sidebarWidth));
  });

  it("a conta prova por que 768-1023px e sempre trilho: com a barra aberta, o grupo nao caberia", () => {
    expect(actionsWidth(iconButton)).toBeGreaterThan(roomForActions(768, sidebar));
    const tablet = mediaBlocks("(min-width: 768px) and (width < 1024px)").join("\n");
    expect(px(prop(rule(tablet, ".platform-grid"), "--platform-sidebar-width"))).toBe(rail);
  });

  it("de 1280px para cima, cabe com o texto inteiro da troca, em ingles e em espanhol", () => {
    expect(actionsWidth(switchWithText())).toBeLessThanOrEqual(roomForActions(1280, sidebar));
  });

  it("a conta prova algo: com o texto inteiro em 768px, nao caberia", () => {
    expect(actionsWidth(switchWithText())).toBeGreaterThan(roomForActions(768, rail));
  });
});

describe("no celular, o nome do lado cabe em 360px", () => {
  const phone = mediaBlocks("(max-width: 767.98px)").join("\n");
  const narrow = mediaBlocks("(max-width: 680px)").join("\n");
  const side = rule(phone, ".platform-topbar__side");
  const fontPx = px(prop(side, "font-size"));
  const letterSpacing = px(prop(side, "letter-spacing"), fontPx);
  const gap = px(prop(rule(phone, ".platform-topbar__inner"), "gap"));
  const padding = px(prop(rule(narrow, ".platform-topbar__inner"), "padding-inline"));
  // Busca, sino, conta (so o avatar abaixo de 640px) e idioma.
  const phoneActions = iconButton * 4 + actionsGap * 3;
  const room = 360 - padding * 2 - LOGO - gap * 2 - phoneActions;

  it.each([
    ["en", en.platform.side],
    ["es", es.platform.side],
  ])("%s: uma palavra so, que cabe", (_locale, labels) => {
    for (const label of [labels.student, labels.teacher, labels.ops]) {
      expect(label, `"${label}" tem mais de uma palavra`).toMatch(/^\S+$/);
      const width = label.length * fontPx * CAPS_EM + label.length * letterSpacing;
      expect(width, `"${label}" mede ~${Math.round(width)}px e sobram ${room}px`).toBeLessThanOrEqual(room);
    }
  });

  it("aluno e professor nao comecam igual (o corte nao pode dizer o mesmo para os dois)", () => {
    for (const labels of [en.platform.side, es.platform.side]) {
      expect(labels.student.slice(0, 4)).not.toBe(labels.teacher.slice(0, 4));
    }
  });
});

/**
 * Telas medias (onda E): o conteudo encolhia ~196px de 1024 a 1179px com a
 * barra aberta por padrao. A conta abaixo usa as larguras da folha (barra,
 * rail, respiro do conteudo) e os minimos escritos nas grades que nao podem
 * encolher. Barra de rolagem classica de 17px, do lado pior.
 */
describe("telas medias: nada estoura de 600 a 1179px", () => {
  const SCROLLBAR = 17;
  const phone = mediaBlocks("(max-width: 767.98px)").join("\n");
  const contentPadding = prop(rule(css, ".platform-content"), "padding");
  const clamp = contentPadding.match(/clamp\(([^,]+),\s*([\d.]+)vw,\s*([^)]+)\)/)!;
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  function defaultSidebar(viewport: number): number {
    if (viewport < 768) return 0;
    return viewport < 1180 ? mediumRail : sidebar;
  }

  function contentWidth(viewport: number, sidebarWidth = defaultSidebar(viewport)): number {
    const padding = Math.min(Math.max(px(clamp[1]), (viewport * parseFloat(clamp[2])) / 100), px(clamp[3]));
    return viewport - sidebarWidth - padding * 2 - SCROLLBAR;
  }

  // Busca + dois filtros dos produtos, lado a lado a partir de md (768px).
  const filters = read("src/components/teacher/teacher-course-studio.tsx")
    .match(/md:grid-cols-\[minmax\((\d+)px,1fr\)_minmax\((\d+)px,auto\)_minmax\((\d+)px,auto\)\]/)!;
  const filtersMin = Number(filters[1]) + Number(filters[2]) + Number(filters[3]) + 2 * 12;

  it("abaixo de 768px: barra de baixo e gaveta, sem barra lateral; a faixa de 'Publicado' sobe acima dela", () => {
    expect(phone).toMatch(/\.platform-sidebar \{\s*display: none;/);
    expect(phone).toMatch(/\.platform-mobile-nav \{\s*display: flex;/);
    expect(phone).toContain("body:has(.platform-mobile-nav) .created-strip");
    expect(defaultSidebar(600)).toBe(0);
  });

  it.each([600, 768, 1024, 1179])("em %ipx os filtros dos produtos cabem na largura do conteudo", (viewport) => {
    const room = contentWidth(viewport);
    // Em 600px os filtros ficam um embaixo do outro (md comeca em 768).
    const needed = viewport >= 768 ? filtersMin : 0;
    expect(needed, `precisa ${needed}px, sobram ${Math.round(room)}px`).toBeLessThanOrEqual(room);
  });

  it.each([768, 1024, 1179])("em %ipx o rail devolve ao conteudo o que a barra aberta comia", (viewport) => {
    expect(contentWidth(viewport) - contentWidth(viewport, sidebar)).toBeCloseTo(sidebar - mediumRail);
  });

  it("os formatos da Home do estudio so vao a 4 colunas no xl; em lg, com a barra aberta, cada um teria < 180px", () => {
    const home = read("src/components/teacher/teacher-studio-dashboard.tsx");
    expect(home).toContain("bg-[var(--color-line)] sm:grid-cols-2 xl:grid-cols-4");
    expect(home).not.toContain("lg:grid-cols-4");
    expect((contentWidth(1024, sidebar) - 3) / 4).toBeLessThan(180);
    for (const viewport of [1024, 1179]) {
      // Duas colunas no padrao (rail) e com a barra aberta por escolha.
      expect((contentWidth(viewport) - 1) / 2).toBeGreaterThan(400);
      expect((contentWidth(viewport, sidebar) - 1) / 2).toBeGreaterThan(330);
    }
  });

  it("a tabela de alunos tem largura minima, mas rola dentro da propria caixa, nunca a pagina", () => {
    const students = read("src/components/teacher/teacher-students-list.tsx");
    expect(students).toMatch(/<div className="mt-4 overflow-x-auto">\s*<table className="w-full min-w-\[720px\]/);
  });
});
