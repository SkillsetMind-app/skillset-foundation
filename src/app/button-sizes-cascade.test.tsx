import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/postcss";
import postcss, { type Root } from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

// jsdom does not resolve the stylesheet cascade (much less @layer), so what
// this file does is: compile the REAL globals.css through the same pipeline as the
// build (PostCSS + @tailwindcss/postcss) and resolve the cascade of the proof
// buttons by hand, following the spec — layer, !important, specificity, order.
// That is exactly how the audit measured the defect (P-16): the base rule
// for buttons outside any layer beat every size utility, and 287 buttons that
// asked for text-xs/text-sm/py-2/py-2.5 came out identical.

const root = process.cwd();
const globalsPath = join(root, "src/app/globals.css");

const PROBE_CLASSES =
  "button-solid button-outline button-danger button-solid-light button-outline-light text-xs text-sm font-semibold font-normal py-2 py-2.5 px-3.5 text-[var(--color-accent-fg)] focus-visible:outline-[var(--focus-ring)] focus-visible:ring-[var(--focus-ring)] disabled:opacity-40 field-input min-h-[88px] transition-colors text-[var(--color-primary)]!";

async function compileGlobals(): Promise<Root> {
  // Only swaps the file scan for a fixed list of classes: the rest
  // of globals.css goes in whole, as in the build.
  const source = readFileSync(globalsPath, "utf8").replace(
    '@import "tailwindcss";',
    `@import "tailwindcss" source(none);\n@source inline("${PROBE_CLASSES}");`,
  );
  const result = await postcss([tailwindcss()]).process(source, { from: globalsPath });
  return postcss.parse(result.css);
}

type Candidate = {
  value: string;
  important: boolean;
  layer: number;
  specificity: number;
  order: number;
};

// Approximation sufficient for the button selectors: ids, classes/attributes/
// pseudo-classes, elements. `:is()`/`:not()` count as their heaviest argument and
// `:where()` counts as zero, as in the spec: counting `:is(.a, .b):is(:disabled, [x])`
// as five classes made the disabled rule win where it does not.
function specificity(selector: string): number {
  let nested = 0;
  const flat = selector.replace(/:(is|not|where)\(([^()]*)\)/g, (_match, fn: string, args: string) => {
    if (fn !== "where") nested += Math.max(...args.split(",").map((arg) => specificity(arg.trim())));
    return "";
  });
  const ids = (flat.match(/#[\w-]+/g) ?? []).length;
  const classes = (flat.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const tags = (flat.match(/(^|[\s>+~(])[a-z][\w-]*/g) ?? []).length;
  return ids * 100 + classes * 10 + tags + nested;
}

function readLayerOrder(css: Root): string[] {
  let order: string[] = [];
  css.walkAtRules("layer", (atRule) => {
    if (!atRule.nodes && atRule.params.includes(",") && order.length === 0) {
      order = atRule.params.split(",").map((name) => name.trim());
    }
  });
  return order;
}

// `:is()` with a list is not reliable in the jsdom selector engine: it opens the
// list into simple selectors (`:is(.a, .b):is(:x, [y])` becomes four) and matches
// any of them. The specificity stays that of the original selector.
function expandIs(selector: string): string[] {
  const match = /:is\(([^()]*)\)/.exec(selector);
  if (!match) return [selector];
  const before = selector.slice(0, match.index);
  const after = selector.slice(match.index + match[0].length);
  return match[1].split(",").flatMap((arg) => expandIs(`${before}${arg.trim()}${after}`));
}

// `hover`: treats the element as if the mouse were over it (the selector matches
// without the `:hover`, but the specificity counts the `:hover`).
function collect(css: Root, element: Element, props: Set<string>, hover = false): Candidate[] {
  const matchesAs = (selector: string) =>
    expandIs(hover ? selector.replace(/:hover/g, "") : selector).some((simple) => element.matches(simple));
  const layerOrder = readLayerOrder(css);
  const unlayered = layerOrder.length;
  const candidates: Candidate[] = [];
  let order = 0;

  css.walkRules((rule) => {
    let layer = unlayered;
    let skip = false;
    for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
      if (parent.type !== "atrule") continue;
      const name = (parent as postcss.AtRule).name;
      if (name === "layer") {
        layer = layerOrder.indexOf((parent as postcss.AtRule).params.trim());
      } else {
        // @media, @supports, @container: outside what the proof button lives in.
        skip = true;
      }
    }
    if (skip) return;

    const matches = rule.selectors.some((selector) => {
      try {
        return matchesAs(selector);
      } catch {
        return false;
      }
    });
    if (!matches) return;

    const bestSelector = Math.max(
      ...rule.selectors.map((selector) => {
        try {
          return matchesAs(selector) ? specificity(selector) : -1;
        } catch {
          return -1;
        }
      }),
    );

    rule.walkDecls((decl) => {
      if (!props.has(decl.prop)) return;
      order += 1;
      candidates.push({
        value: decl.value,
        important: decl.important,
        layer,
        specificity: bestSelector,
        order,
      });
    });
  });

  return candidates;
}

// CSS Cascade 5: !important beats normal; among normals, unlayered wins and
// then the LATEST layer; among important ones the order inverts (earliest layer
// wins, unlayered loses to all); then specificity, then order.
function resolve(css: Root, element: Element, ...props: string[]): string | undefined {
  return pick(css, collect(css, element, new Set(props)));
}

function resolveHover(css: Root, element: Element, ...props: string[]): string | undefined {
  return pick(css, collect(css, element, new Set(props), true));
}

function pick(css: Root, candidates: Candidate[]): string | undefined {
  const unlayered = readLayerOrder(css).length;
  const key = (candidate: Candidate) => [
    candidate.important ? 1 : 0,
    candidate.important
      ? candidate.layer === unlayered
        ? -Infinity
        : -candidate.layer
      : candidate.layer,
    candidate.specificity,
    candidate.order,
  ];
  const winner = [...candidates].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let index = 0; index < ka.length; index += 1) {
      if (ka[index] !== kb[index]) return ka[index] - kb[index];
    }
    return 0;
  }).at(-1);
  return winner?.value;
}

let css: Root;

beforeAll(async () => {
  css = await compileGlobals();
}, 60_000);

function mount(className: string, tag = "button"): Element {
  const element = document.createElement(tag);
  element.className = className;
  document.body.append(element);
  return element;
}

describe("button sizes (P-16)", () => {
  it("two buttons that ask for different sizes come out different", () => {
    const small = mount("button-solid px-3.5 py-2 text-xs");
    const large = mount("button-solid px-3.5 py-2.5 text-sm");

    const smallFont = resolve(css, small, "font-size");
    const largeFont = resolve(css, large, "font-size");
    expect(smallFont).toBeDefined();
    expect(smallFont).not.toBe(largeFont);
    // The single value that the base rule imposed on all 287 buttons.
    expect(smallFont).not.toBe("0.84375rem");
    expect(largeFont).not.toBe("0.84375rem");

    const smallPadding = resolve(css, small, "padding", "padding-block", "padding-top");
    const largePadding = resolve(css, large, "padding", "padding-block", "padding-top");
    expect(smallPadding).not.toBe(largePadding);
    expect(smallPadding).not.toBe("0.75rem 1.25rem");
  });

  it("the 44px minimum target still holds when nobody asks for another height", () => {
    const button = mount("button-outline px-3.5 py-2 text-xs");
    expect(resolve(css, button, "min-height")).toBe("44px");
  });

  // The main action of product creation (Continue, Create, Publish). The
  // 48px, 15px and weight 600 (the owner's decision: solid primary, taller,
  // 600). Before, a layer-less `button { font: inherit }` beat the `components`
  // layer and .button-lg had to live outside it with 800.
  it("the large pair comes out with 48px and 15px/600 on a <button>", () => {
    const primary = mount("button-solid button-lg");
    const secondary = mount("button-outline button-lg");

    expect(resolve(css, primary, "min-height")).toBe("48px");
    expect(resolve(css, primary, "font-weight", "font")).toBe("600");
    expect(resolve(css, primary, "font-size", "font")).toBe("0.9375rem");
    expect(resolve(css, secondary, "min-height")).toBe("48px");
    expect(resolve(css, secondary, "font-weight", "font")).toBe("600");
    expect(resolve(css, secondary, "border-color")).toBe("var(--color-primary)");
  });

  // The rule `button, input, textarea, select { font: inherit }` outside any layer
  // made EVERY <button> come out 16px/400 and every field ignore text-sm/font-normal.
  // The `font: inherit` now comes only from the preflight (base layer).
  it("a <button> .button-solid comes out 14px/600, not the inherited letter size", () => {
    const button = mount("button-solid");

    expect(resolve(css, button, "font-size", "font")).toBe("0.875rem");
    expect(resolve(css, button, "font-weight", "font")).toBe("600");
  });

  it("font-size utilities hold on <button> and on a field", () => {
    const button = mount("text-sm font-semibold");
    const input = mount("text-sm font-normal", "input");

    expect(resolve(css, button, "font-size", "font")).toContain("--text-sm");
    expect(resolve(css, button, "font-weight", "font")).toContain("--font-weight-semibold");
    expect(resolve(css, input, "font-size", "font")).toContain("--text-sm");
    expect(resolve(css, input, "font-weight", "font")).toContain("--font-weight-normal");
  });

  // The light hero variants lived in their own block, without min-height:
  // padding 10 + line 20 + border 2 = 42px on phone and tablet (QA 07/09).
  it("as variantes claras (hero) guardam os mesmos 44px", () => {
    expect(resolve(css, mount("button-solid-light"), "min-height")).toBe("44px");
    expect(resolve(css, mount("button-outline-light"), "min-height")).toBe("44px");
  });

  it("no button variant lowers the 44px target to 36px or 40px", () => {
    const dir = join(root, "src");
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx"),
      )
      .map((entry) => join(entry.parentPath, entry.name));
    const undersizedButton =
      /className\s*=\s*(?:\{\s*)?["'`][^"'`]*(?=[^"'`]*\bbutton-(?:solid|outline|accent|danger)\b)(?=[^"'`]*\bmin-h-(?:9|10)\b)[^"'`]*["'`]/g;
    const violations: string[] = [];

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(undersizedButton)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push(`${file}:${line}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  // F18: 12 targets were left over (tabs, selects, text buttons) at min-h-9/min-h-10
  // outside the button-* variants. The rule is the same for any touch target.
  it("no target in src/components asks for min-h-9 or min-h-10 (36/40px)", () => {
    const dir = join(root, "src/components");
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx"),
      )
      .map((entry) => join(entry.parentPath, entry.name));
    const violations: string[] = [];

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bmin-h-(?:9|10)\b/g)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push(`${file}:${line}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// C-11: the disabled opacity came from each call, in five values. The
// central rule stays outside any layer and beats the utility, so a call that
// still asks for 40% comes out with the same 60% as every disabled button.
describe("disabled button (C-11)", () => {
  it("comes out at 60% and the rest background, even when asking for another opacity", () => {
    const button = mount("button-solid disabled:opacity-40");
    button.setAttribute("disabled", "");
    expect(resolve(css, button, "opacity")).toBe("0.6");
    expect(resolve(css, button, "background")).toBe("var(--color-primary)");
  });

  function disabled(className: string, wrapper?: Record<string, string>, off = true): Element {
    const button = mount(className);
    if (off) button.setAttribute("disabled", "");
    if (wrapper) {
      const box = document.createElement("div");
      for (const [name, value] of Object.entries(wrapper)) box.setAttribute(name, value);
      document.body.append(box);
      box.append(button);
    }
    return button;
  }

  // Each case: the disabled button has, at rest and with the mouse over it, the
  // same look as the enabled button at rest (in the same theme and scope).
  const member = { class: "member-classroom", "data-members-theme": "light" };
  it.each([
    ["button-solid", undefined, "background"],
    ["button-outline", undefined, "background"],
    // The large pair: its :hover (two class selectors) beat the disabled
    // rule and the faded "Back" went from gray to navy.
    ["button-outline button-lg", undefined, "border-color"],
    // In the dark, the rest border of the dark theme, not the light one.
    ["button-danger", { "data-theme": "dark" }, "border-color"],
    ["button-outline", { "data-theme": "dark" }, "border-color"],
    // The outline label: the :hover switches to the dark navy with !important.
    ["button-outline", undefined, "color"],
    ["button-outline", { "data-theme": "dark" }, "color"],
    ["button-danger button-danger-solid", undefined, "background"],
    // Members area: the scope rules weigh more than the central one.
    ["button-solid", member, "background"],
    ["button-outline", member, "border-color"],
    ["button-icon", undefined, "color"],
  ] as const)("%s disabled (%o): %s at rest, also on hover", (className, wrapper, prop) => {
    const props = prop === "background" ? ["background", "background-color"] : [prop];
    const resting = resolve(css, disabled(className, wrapper, false), ...props);
    expect(resting).toBeTruthy();
    const button = disabled(className, wrapper);
    expect(resolve(css, button, ...props)).toBe(resting);
    expect(resolveHover(css, button, ...props)).toBe(resting);
  });

  // Proof that the forced hover works: the ENABLED button changes.
  it("enabled, the forced hover darkens the background", () => {
    const button = disabled("button-solid", undefined, false);
    expect(resolveHover(css, button, "background")).toBe("var(--color-primary-dark)");
  });

  it("in the members area the disabled one gets no shadow and does not rise on hover", () => {
    const button = disabled("button-solid", { class: "member-classroom", "data-members-theme": "light" });
    expect(resolveHover(css, button, "box-shadow")).toBe("none");
    expect(resolveHover(css, button, "transform")).toBe("none");
  });

  it("the icon-only disabled button has the blocked cursor and the 60%", () => {
    const button = disabled("button-icon");
    expect(resolve(css, button, "cursor")).toBe("not-allowed");
    expect(resolve(css, button, "opacity")).toBe("0.6");
  });
});

// C-05: 44px on every field, the height of the button next to it; but a JSX min-h-*
// (the 88px text boxes of the community) still holds.
describe("field height (C-05)", () => {
  it("a .field-input field is at least 44px", () => {
    expect(resolve(css, mount("field-input", "input"), "min-height")).toBe("44px");
  });

  it("the text box that asks for 88px stays at 88px", () => {
    expect(resolve(css, mount("field-input min-h-[88px]", "textarea"), "min-height")).toBe("88px");
  });
});

// C-09: 118 hand-written transitions (`transition-colors` without a duration)
// ran at 150ms and the Tailwind curve, next to buttons at 180ms.
describe("transition timing (C-09)", () => {
  it("a transition-* utility without a duration uses the motion tokens", () => {
    const element = mount("transition-colors");
    expect(resolve(css, element, "transition-duration")).toContain("var(--default-transition-duration)");
    expect(resolve(css, element, "transition-timing-function")).toContain(
      "var(--default-transition-timing-function)",
    );
    expect(resolve(css, document.documentElement, "--default-transition-duration")).toBe("var(--duration-base)");
    // The curve stays Tailwind's (public site motion approved that way).
    expect(resolve(css, document.documentElement, "--default-transition-timing-function")).toBe(
      "cubic-bezier(0.4, 0, 0.2, 1)",
    );
  });
});

// The globals.css link rule once had `color: inherit` OUTSIDE any layer: it
// beat every Tailwind utility, and a link that asked for the accent color came out
// with the parent's (the text faded around it). Only the `!` got past it. Today the
// inheritance comes only from the preflight (base layer) and the link's utility holds.
describe("link color", () => {
  it("on an <a>, the color utility holds without `!` (and with `!` too)", () => {
    expect(resolve(css, mount("text-[var(--color-accent-fg)]", "a"), "color")).toBe("var(--color-accent-fg)");
    expect(resolve(css, mount("text-[var(--color-primary)]!", "a"), "color")).toBe("var(--color-primary)");
  });

  it("without a utility, the <a> inherits the parent's color through the preflight", () => {
    expect(resolve(css, mount("font-semibold", "a"), "color")).toBe("inherit");
  });

  it("a link dressed as a button keeps the .button-* color, with a color utility or without", () => {
    expect(resolve(css, mount("button-outline text-[var(--color-accent-fg)]", "a"), "color")).toBe(
      "var(--color-primary)",
    );
    expect(resolve(css, mount("button-solid text-[var(--color-accent-fg)]", "a"), "color")).toBe("#ffffff");
    expect(resolve(css, mount("button-danger text-[var(--color-accent-fg)]", "a"), "color")).toBe(
      "var(--color-danger-fg)",
    );
  });

  it("globals.css does not bring back an unlayered color on the <a> rule", () => {
    // Read from the source, without compiling: a rule with no @layer around it that catches
    // ANY link (the target is an <a> with no class or id, in any form) and
    // declares `color` reopens the defect on every link. A rule tied to a class
    // (`.lesson-modal__trail a`) is the design of one place and stays out.
    const bareAnchor = (selector: string) => {
      // Arguments of :not()/:is() and the content of [attribute] do not count:
      // `a:not(.x)` still catches almost every link.
      let flat = selector.trim().replace(/\[[^\]]*\]/g, "[]");
      while (/\([^()]*\)/.test(flat)) flat = flat.replace(/\(([^()]*)\)/g, "%");
      if (/[.#]/.test(flat) || flat.includes("::")) return false;
      const subject = flat.split(/\s*[>+~]\s*|\s+/).filter(Boolean).at(-1) ?? "";
      if (!/^(a|\*)?(\[\]|:[\w-]+%?)*$/.test(subject)) return false;
      return subject.startsWith("a") || /:(any-)?link\b/.test(subject);
    };
    const hits = ["a", "a:hover", "a[href]", "a:any-link", ":any-link", ":link", "*:link"];
    hits.push("html a", "body a", "body > a:visited", "a:not(.button-solid)");
    for (const hit of hits) expect(bareAnchor(hit), hit).toBe(true);
    const misses = [".lesson-modal__trail a", ".site-header__link", "a.foo", "#x a", "a::after"];
    misses.push("button", "abbr", ".x :any-link", ":where([id])", "*");
    for (const miss of misses) expect(bareAnchor(miss), miss).toBe(false);

    const source = postcss.parse(readFileSync(globalsPath, "utf8"));
    const offenders: string[] = [];
    source.walkRules((rule) => {
      for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
        if (parent.type === "atrule" && (parent as postcss.AtRule).name === "layer") return;
      }
      if (!rule.selectors.some(bareAnchor)) return;
      rule.walkDecls("color", (decl) => {
        offenders.push(`${rule.selector} { color: ${decl.value} } (linha ${decl.source?.start?.line})`);
      });
    });
    expect(offenders).toEqual([]);
  });
});

describe("anel de foco (F19)", () => {
  // `outline-[var(--x)]` is ambiguous for Tailwind (width or color?). The proof is
  // the compiled CSS: the token has to become a color, in both utilities.
  it("`focus-visible:outline-[var(--focus-ring)]` and `ring-[...]` compile as a color", () => {
    const compiled = css.toString();
    expect(compiled).toContain("outline-color: var(--focus-ring)");
    expect(compiled).toContain("--tw-ring-color: var(--focus-ring)");
  });
});

describe("danger button (P-08)", () => {
  it("`.button-danger` paints the text with the danger ink", () => {
    const button = mount("button-danger px-3.5 py-2 text-xs");
    expect(resolve(css, button, "color")).toBe("var(--color-danger-fg)");
  });

  // The cause: the old pattern (outline + color utility) never reached the screen.
  it("a color utility on `.button-outline` stays dead — that is why the variant exists", () => {
    const button = mount("button-outline px-3.5 py-2 text-xs text-[var(--color-accent-fg)]");
    expect(resolve(css, button, "color")).toBe("var(--color-primary)");
  });

  it("no outline button tries to paint danger with a utility", () => {
    const dir = join(root, "src");
    // Tests (this one included) quote the dead pattern on purpose.
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx"),
      )
      .map((entry) => join(entry.parentPath, entry.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /button-outline[^"'`]*text-\[var\(--color-(accent|danger)-fg\)\]/,
      );
    }
  });
});
