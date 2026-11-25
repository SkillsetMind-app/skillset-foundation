import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { brand } from "@/data/brand";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";

/**
 * The platform top bar has `overflow: hidden` on the column and a group of
 * actions that does not shrink. If what is in it goes past the width, what is left
 * out is precisely the end of the group: the language and the account menu (Sign out,
 * Settings). That is what the side switch with the full text ("Ir al área
 * del profesor") and a second Help did from 768 to ~1180px.
 *
 * jsdom does not measure layout, so the stylesheet is read as text and the math
 * is done here, with the widths the sheet itself declares. What is not in the
 * sheet (avatar, search field at its minimum, average width of a letter) goes in as a
 * named constant, pushed to the worse side.
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

/** Body of the first rule with exactly this selector in `source`. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = source.match(new RegExp(`(?:^|[\\n}])\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(found, `rule ${selector} not found`).not.toBeNull();
  return found![1];
}

function prop(body: string, name: string): string {
  const found = body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`));
  expect(found, `${name} not declared`).not.toBeNull();
  return found![1].replace(/\s*!important/, "").trim();
}

function px(value: string, fontPx = 16): number {
  if (value.endsWith("rem")) return parseFloat(value) * 16;
  if (value.endsWith("em")) return parseFloat(value) * fontPx;
  if (value.endsWith("px")) return parseFloat(value);
  throw new Error(`unidade inesperada: ${value}`);
}

// Outside the sheet (worse side): avatar size-8, logo size-10, the search field
// shrunk to its minimum (magnifier + shortcut hint + gaps), and the average width
// of a bold uppercase letter.
const AVATAR = 32;
const LOGO = 40;
const SEARCH_MIN = 110;
const CAPS_EM = 0.74;
const TEXT_EM = 0.62;

const inner = rule(css, ".platform-topbar__inner");
const actions = rule(css, ".platform-topbar__actions");
// The icon buttons of the group (theme, Advisor, bell, search, language): 44px.
const iconButton = px(prop(
  css.match(/\.platform-topbar__actions > button:not\(\.locale-switcher-compact\):not\(\.account-menu-trigger\):not\(\.help-menu-trigger\)\s*\{([^}]*)\}/)![1],
  "width",
));
const innerGap = px(prop(inner, "gap"));
const innerPadding = px(prop(inner, "padding").split(/\s+/)[1]);
const actionsGap = px(prop(actions, "gap"));
const sidebar = px(css.match(/--sidebar-width:\s*([^;]+);/)![1]);
const rail = px(prop(rule(css, ".platform-grid--collapsed"), "--platform-sidebar-width"));
// Wave E: with no saved choice, from 768 to 1179px the column and the rail are already in the CSS.
const mediumRail = px(prop(
  rule(mediaBlocks("(min-width: 768px) and (width < 1180px)").join("\n"), ".platform-grid--auto"),
  "--platform-sidebar-width",
));

/** The account menu with a name: avatar, name at most, arrow and gaps. */
function accountTrigger(): number {
  const name = px(prop(rule(css, ".account-menu-trigger__name"), "max-width"));
  const gap = px(prop(rule(css, ".account-menu-trigger"), "gap"));
  return 6 + AVATAR + gap + name + gap + 12 + 14 + 2;
}

/** Side switch with the full text, in the language where it is longer. */
function switchWithText(): number {
  const longest = Math.max(
    ...[en, es].flatMap((dict) => [dict.platform.side.goStudent, dict.platform.side.goTeacher].map((label) => label.length)),
  );
  return 14 + 16 + 6 + longest * 13 * TEXT_EM + 14 + 2;
}

/** Side switch + theme + Advisor + bell + account + language: the whole group. */
function actionsWidth(switchWidth: number): number {
  const items = [switchWidth, iconButton, iconButton, iconButton, accountTrigger(), iconButton];
  return items.reduce((sum, width) => sum + width, 0) + actionsGap * (items.length - 1);
}

/** What is left for the group after the sidebar, the gaps, the path
 *  (which shrinks to zero) and the search at its minimum. */
function roomForActions(viewport: number, sidebarWidth: number): number {
  return viewport - sidebarWidth - innerPadding * 2 - innerGap * 2 - SEARCH_MIN;
}

describe("the top bar fits from 768px up", () => {
  const below1280 = mediaBlocks("(max-width: 1279.98px)").join("\n");

  it("below 1280px the side switch keeps only the icon and the name hidden for the screen reader", () => {
    const button = rule(below1280, ".platform-topbar__switch");
    expect(px(prop(button, "width"))).toBe(iconButton);
    expect(prop(button, "padding")).toBe("0");

    const label = rule(below1280, ".platform-topbar__switch-label");
    expect(prop(label, "position")).toBe("absolute");
    expect(prop(label, "width")).toBe("1px");
    expect(prop(label, "clip")).toBe("rect(0 0 0 0)");
  });

  it("Help no longer lives at the top of the platform", () => {
    expect(css).not.toMatch(/\.platform-topbar__help\b/);
  });

  it.each([
    [768, "rail, the default", mediumRail],
    [1023, "rail, the default", mediumRail],
    [1024, "rail, the default", mediumRail],
    [1179, "rail, the default", mediumRail],
    [1024, "sidebar open by choice", sidebar],
    [1179, "sidebar open by choice", sidebar],
    [1180, "sidebar open, the default", sidebar],
    [1279, "sidebar open, the default", sidebar],
  ])("at %spx (%s), the action group with the icon-only switch fits", (viewport, _label, sidebarWidth) => {
    expect(actionsWidth(iconButton)).toBeLessThanOrEqual(roomForActions(viewport, sidebarWidth));
  });

  it("the math proves why 768-1023px is always a rail: with the bar open, the group would not fit", () => {
    expect(actionsWidth(iconButton)).toBeGreaterThan(roomForActions(768, sidebar));
    const tablet = mediaBlocks("(min-width: 768px) and (width < 1024px)").join("\n");
    expect(px(prop(rule(tablet, ".platform-grid"), "--platform-sidebar-width"))).toBe(rail);
  });

  it("from 1280px up, it fits with the full switch text, in English and Spanish", () => {
    expect(actionsWidth(switchWithText())).toBeLessThanOrEqual(roomForActions(1280, sidebar));
  });

  it("the math proves something: with the full text at 768px, it would not fit", () => {
    expect(actionsWidth(switchWithText())).toBeGreaterThan(roomForActions(768, rail));
  });
});

describe("on the phone, the side name fits at 360px", () => {
  const phone = mediaBlocks("(max-width: 767.98px)").join("\n");
  const narrow = mediaBlocks("(max-width: 680px)").join("\n");
  const side = rule(phone, ".platform-topbar__side");
  const fontPx = px(prop(side, "font-size"));
  const letterSpacing = px(prop(side, "letter-spacing"), fontPx);
  const gap = px(prop(rule(phone, ".platform-topbar__inner"), "gap"));
  const padding = px(prop(rule(narrow, ".platform-topbar__inner"), "padding-inline"));
  // Search, bell, account (only the avatar below 640px) and language.
  const phoneActions = iconButton * 4 + actionsGap * 3;
  const room = 360 - padding * 2 - LOGO - gap * 2 - phoneActions;

  it.each([
    ["en", en.platform.side],
    ["es", es.platform.side],
  ])("%s: a single word, which fits", (_locale, labels) => {
    for (const label of [labels.student, labels.teacher, labels.ops]) {
      expect(label, `"${label}" has more than one word`).toMatch(/^\S+$/);
      const width = label.length * fontPx * CAPS_EM + label.length * letterSpacing;
      expect(width, `"${label}" measures ~${Math.round(width)}px and ${room}px are left`).toBeLessThanOrEqual(room);
    }
  });

  it("learner and teacher do not start the same (the cut cannot say the same for both)", () => {
    for (const labels of [en.platform.side, es.platform.side]) {
      expect(labels.student.slice(0, 4)).not.toBe(labels.teacher.slice(0, 4));
    }
  });
});

/**
 * Medium screens (wave E): the content shrank ~196px from 1024 to 1179px with the
 * bar open by default. The math below uses the widths of the sheet (bar,
 * rail, content gap) and the minimums written in the grids that cannot
 * shrink. Classic 17px scrollbar, on the worse side.
 */
describe("medium screens: nothing overflows from 600 to 1179px", () => {
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

  // Search + two product filters, side by side from md (768px).
  const filters = read("src/components/teacher/teacher-course-studio.tsx")
    .match(/md:grid-cols-\[minmax\((\d+)px,1fr\)_minmax\((\d+)px,auto\)_minmax\((\d+)px,auto\)\]/)!;
  const filtersMin = Number(filters[1]) + Number(filters[2]) + Number(filters[3]) + 2 * 12;

  it("below 768px: bottom bar and drawer, no sidebar; the 'Published' strip goes up above it", () => {
    expect(phone).toMatch(/\.platform-sidebar \{\s*display: none;/);
    expect(phone).toMatch(/\.platform-mobile-nav \{\s*display: flex;/);
    expect(phone).toContain("body:has(.platform-mobile-nav) .created-strip");
    expect(defaultSidebar(600)).toBe(0);
  });

  it.each([600, 768, 1024, 1179])("at %ipx the product filters fit in the content width", (viewport) => {
    const room = contentWidth(viewport);
    // At 600px the filters stack one under the other (md starts at 768).
    const needed = viewport >= 768 ? filtersMin : 0;
    expect(needed, `needs ${needed}px, ${Math.round(room)}px are left`).toBeLessThanOrEqual(room);
  });

  it.each([768, 1024, 1179])("at %ipx the rail gives back to the content what the open bar used to eat", (viewport) => {
    expect(contentWidth(viewport) - contentWidth(viewport, sidebar)).toBeCloseTo(sidebar - mediumRail);
  });

  it("the studio Home formats only go to 4 columns at xl; at lg, with the bar open, each one would have < 180px", () => {
    const home = read("src/components/teacher/teacher-studio-dashboard.tsx");
    expect(home).toContain("bg-[var(--color-line)] sm:grid-cols-2 xl:grid-cols-4");
    expect(home).not.toContain("lg:grid-cols-4");
    expect((contentWidth(1024, sidebar) - 3) / 4).toBeLessThan(180);
    for (const viewport of [1024, 1179]) {
      // Two columns by default (rail) and with the bar open by choice.
      expect((contentWidth(viewport) - 1) / 2).toBeGreaterThan(400);
      expect((contentWidth(viewport, sidebar) - 1) / 2).toBeGreaterThan(330);
    }
  });

  it("the learners table has a minimum width, but scrolls inside its own box, never the page", () => {
    const students = read("src/components/teacher/teacher-students-list.tsx");
    expect(students).toMatch(/<div className="mt-4 overflow-x-auto">\s*<table className="w-full min-w-\[720px\]/);
  });
});

/**
 * Public site bar (SiteNav). The audit asked for the links from
 * 1024px (iPad landscape). The math below, with the widths of the sheet and the letters
 * pushed to the worse side, shows that there they do not fit with the account open
 * even in Spanish: that is why the menu stays until 1279px. The side margin, that one
 * yes, becomes the pages' margin at every width.
 */
describe("public site bar: links from 1280px up, margin equal to the pages'", () => {
  const SCROLLBAR = 17;
  const FONT = 14;
  const CHEVRON = 14;
  const ICON = 16;
  const BORDER = 2;
  const LOCALE = 44; // LocaleSwitcher compacto: size-11.
  const BUTTON_PAD = { belowXl: 12, xl: 16 }; // "button-solid px-3 xl:px-4" no site-nav.tsx
  const nav = readFileSync(join(process.cwd(), "src/components/site/site-nav.tsx"), "utf8");
  const below1280 = mediaBlocks("(width < 1280px)").join("\n");
  const root = (name: string) => px(css.match(new RegExp(`--${name}:\\s*([^;]+);`))![1]);

  const inner = rule(css, ".site-header__inner");
  const innerGap = px(prop(inner, "gap"));
  const links = rule(css, ".site-header__links");
  const link = rule(css, ".site-header__link");
  const signin = rule(css, ".btn-signin");
  const signinBelow1280 = below1280.match(/\.btn-signin,\s*\.btn-cta-hero\s*\{([^}]*)\}/)![1];
  const trigger = rule(css, ".account-menu-trigger");
  // Full bar logo: h-8 (32px) at the file's proportion.
  const logo = 32 * (brand.logoFullLightSize.width / brand.logoFullLightSize.height);
  const text = (label: string) => label.length * FONT * TEXT_EM;

  function linksWidth(labels: string[]): number {
    const padX = px(prop(link, "padding").split(/\s+/)[1]);
    return labels.reduce((sum, label) => sum + text(label) + padX * 2, 0) + px(prop(links, "gap")) * (labels.length - 1);
  }

  function signedOut(dict: typeof en, xl: boolean): number {
    const signinPad = xl ? px(prop(signin, "padding").split(/\s+/)[1]) : px(prop(signinBelow1280, "padding-left"));
    const signinWidth = text(dict.nav.signIn) + signinPad * 2 + px(prop(signin, "gap")) + CHEVRON + BORDER;
    const create = text(dict.nav.getStarted) + (xl ? BUTTON_PAD.xl : BUTTON_PAD.belowXl) * 2 + BORDER;
    return signinWidth + 8 + create; // gap-2 entre os dois
  }

  function signedIn(dict: typeof en, xl: boolean): number {
    const dashboard = ICON + 8 + text(dict.nav.dashboard) + (xl ? BUTTON_PAD.xl : BUTTON_PAD.belowXl) * 2 + BORDER;
    const [, right, , left] = prop(trigger, "padding").split(/\s+/).map((value) => px(value));
    const gap = px(prop(trigger, "gap"));
    const account = left + AVATAR + gap + px(prop(rule(css, ".account-menu-trigger__name"), "max-width")) + gap + 12 + right + BORDER;
    return dashboard + px(prop(rule(css, ".site-header__actions"), "gap")) + account;
  }

  /** Logo, links and the action group (without the menu button: the better side). */
  function headerWidth(labels: string[], actions: number): number {
    const actionsGap = px(prop(rule(css, ".site-header__actions"), "gap"));
    return logo + innerGap * 2 + px(prop(links, "margin-left")) + linksWidth(labels) + actions + actionsGap + LOCALE;
  }

  function room(viewport: number): number {
    const pad = root("container-pad-desktop");
    return Math.min(viewport - SCROLLBAR, px(prop(inner, "max-width"))) - pad * 2;
  }

  const labels = (dict: typeof en, store: boolean) =>
    [store ? dict.nav.courses : null, dict.nav.forCreators, dict.nav.pricing, dict.nav.promise, dict.nav.help].filter(
      (label): label is string => label !== null,
    );

  it("the numbers come from site-nav: px-3 buttons below xl, px-4 at xl, and the menu disappears at xl", () => {
    expect(nav).toContain('className="button-solid gap-2 px-3 xl:px-4"');
    expect(nav).toContain('className="button-solid px-3 xl:px-4"');
    expect(nav).toMatch(/aria-controls="site-mobile-menu"[\s\S]*xl:hidden/);
    expect(prop(below1280.match(/\.site-header__links\s*\{([^}]*)\}/)![1], "display")).toBe("none");
  });

  it.each([
    ["en", en],
    ["es", es],
  ] as const)("%s: from 1280px up everything fits, with the store open, logged in or not", (_locale, dict) => {
    for (const actions of [signedOut(dict, true), signedIn(dict, true)]) {
      expect(headerWidth(labels(dict, true), actions)).toBeLessThanOrEqual(room(1280));
    }
  });

  it("the math proves why the links wait for 1280px: at 1024px they do not fit logged in, nor in Spanish logged out", () => {
    for (const dict of [en, es]) {
      expect(headerWidth(labels(dict, false), signedIn(dict, false))).toBeGreaterThan(room(1024));
    }
    expect(headerWidth(labels(es, false), signedOut(es, false))).toBeGreaterThan(room(1024));
    expect(headerWidth(labels(en, true), signedOut(en, false))).toBeGreaterThan(room(1024));
  });

  it("the bar margin is the pages' one: 20px on the phone and 32px from 40rem (sm), at every width", () => {
    expect(prop(inner, "padding")).toBe("8px var(--container-pad-mobile)");
    expect(root("container-pad-mobile")).toBe(20);
    const tablet = rule(mediaBlocks("(width >= 40rem)").join("\n"), ".site-header__inner");
    expect(prop(tablet, "padding-inline")).toBe("var(--container-pad-desktop)");
    expect(root("container-pad-desktop")).toBe(32);
    // Nothing below 1280px squeezes the bar again.
    expect(below1280).not.toMatch(/\.site-header__inner\s*\{/);
    const page = readFileSync(join(process.cwd(), "src/components/site/public-page.tsx"), "utf8");
    expect(page).toContain("px-5 py-12 sm:px-8");
  });
});
