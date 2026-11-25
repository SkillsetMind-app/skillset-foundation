import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CapabilitiesGrid } from "@/components/site/capabilities-grid";
import { ForCreatorsBand } from "@/components/site/for-creators-band";
import { HowItWorksStrip } from "@/components/site/how-it-works-strip";
import { MarketingHero } from "@/components/site/marketing-hero";
import { PromisePreviewBand } from "@/components/site/promise-preview-band";
import RefundPolicyPage from "@/app/refund-policy/page";

// These sections became server components: they resolve the language from the
// cookie. No cookie = English, which is the text the tests below expect.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/site/site-footer", () => ({
  SiteFooter: () => null,
}));

afterEach(cleanup);

function readCss() {
  return readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
}

function readSource(relative: string) {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/** Body of a CSS rule, from the selector to the closing brace. */
function ruleBody(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector} does not exist`).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

describe("header: one fixed layer, no animated layout", () => {
  it("is a full-width fixed bar, not an island with a margin", () => {
    const header = ruleBody(readCss(), ".site-header");

    expect(header).toMatch(/position:\s*fixed/);
    expect(header).toMatch(/top:\s*0/);
    // The floating island had `margin: 14px 20px 0` and `top: 14px`.
    expect(header).not.toMatch(/margin/);
  });

  it("on scroll it animates only the shadow, in 150ms", () => {
    const css = readCss();
    const header = ruleBody(css, ".site-header");

    expect(header).toMatch(/transition:\s*box-shadow 150ms/);
    // No layout property in the transition: that is what made the page
    // reposition itself on every scroll frame.
    expect(header).not.toMatch(/transition:[^;]*(margin|padding|top)/);

    const scrolled = ruleBody(css, ".site-header.scrolled");
    expect(scrolled).toMatch(/box-shadow/);
    expect(scrolled).not.toMatch(/(margin|padding|top):/);
  });

  it("the inner frame is no longer a card with a shadow", () => {
    const inner = ruleBody(readCss(), ".site-header__inner");

    expect(inner).not.toMatch(/box-shadow/);
    expect(inner).not.toMatch(/border-radius/);
    expect(inner).toMatch(/min-height:\s*var\(--site-header-height\)/);
  });

  it("the strip that reserves the space uses the same measure as the bar", () => {
    const css = readCss();

    expect(css).toMatch(/--site-header-height:\s*\d+px/);
    expect(ruleBody(css, ".site-header-spacer")).toMatch(
      /height:\s*var\(--site-header-height\)/,
    );
  });

  it("the header targets are at least 44px tall", () => {
    const css = readCss();

    for (const selector of [".site-header__link", ".btn-signin", ".btn-cta-hero"]) {
      expect(ruleBody(css, selector), selector).toMatch(/min-height:\s*44px/);
    }
  });
});

describe("page background", () => {
  it("the fixed gradient behind everything is gone", () => {
    // .page-shell::before painted a `position: fixed` gradient at z-index -2
    // behind the whole page; it was what made the cards "float".
    expect(readCss()).not.toMatch(/\.page-shell::before\s*\{/);
  });
});

describe("hero", () => {
  it("no longer fits through a negative margin, and the height is a clamp", async () => {
    const { container } = render(await MarketingHero());
    const section = container.querySelector("section");

    expect(section?.className).not.toMatch(/-mt-/);
    expect(section?.className).toContain("min-h-[clamp(560px,92svh,900px)]");
    expect(section?.className).not.toContain("min-h-[100svh]");
  });

  it("on the phone the main button comes before the long paragraph", async () => {
    // Measured at 375x812 on the 1st visit: the 8-line paragraph pushed the button
    // to y=602, under the cookie banner (top at 572). Teachable, Podia,
    // Stan and Thinkific show the button on the phone's 1st screen. From `sm`
    // up the order goes back to title → paragraph → buttons.
    const { container } = render(await MarketingHero());
    const title = container.querySelector("h1");
    const copy = title?.parentElement;
    // The support (audience line + "Education, not therapy") is the 1st block after the title.
    const lead = copy?.querySelector(":scope > div");

    expect(copy?.className).toContain("flex-col");
    // `space-y-*` is margin by position in the DOM: with `order` it would come out wrong.
    expect(copy?.className).not.toMatch(/space-y-/);
    expect(lead?.className).toContain("order-last");
    expect(lead?.className).toContain("sm:order-none");
  });

  it("swaps portraits again: only the hero turns on the BrandPortrait rotation", () => {
    // Wave 2 (#174) replaced the rotation with one fixed portrait per visit; the
    // owner asked for the images to swap back on the home page. The login stays fixed
    // (without the prop), so the contract lives here, in the hero.
    expect(readSource("src/components/site/marketing-hero.tsx")).toMatch(
      /<BrandPortrait[^>]*\brotate\b/,
    );
  });
});

describe("footer", () => {
  it("is a strip with a rule on top, not a card with a shadow", () => {
    const source = readSource("src/components/site/site-footer.tsx");
    const footerTag = source.slice(
      source.indexOf("<footer"),
      source.indexOf(">", source.indexOf("<footer")),
    );

    expect(footerTag).toContain("border-t");
    expect(source).not.toContain("shadow-[var(--shadow-soft)]");
    expect(source).not.toMatch(/\brounded-(?:lg|xl|\[\d+px\]) border/);
  });
});

describe("long documents use the same frame as the other public pages", () => {
  it("the refund policy mounts PublicPage in reading mode", async () => {
    expect(readSource("src/components/site/legal-article.tsx")).toContain(
      "<PublicPage",
    );

    render(await RefundPolicyPage());

    // Same h1 as the rest of the site (.page-title), not the fixed text-6xl of the
    // old template.
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveClass("page-title");
    expect(title.className).not.toMatch(/text-(5|6)xl/);

    // Reading column ~72ch, instead of a card inside a card.
    expect(document.querySelector("main")?.className).toContain("max-w-[72ch]");
  });
});

describe("marketing sections became server components", () => {
  it.each([
    "src/components/site/marketing-hero.tsx",
    "src/components/site/capabilities-grid.tsx",
    "src/components/site/how-it-works-strip.tsx",
    "src/components/site/promise-preview-band.tsx",
    "src/components/site/for-creators-band.tsx",
    "src/components/site/home-facts-band.tsx",
    "src/components/site/home-faq.tsx",
    "src/components/site/home-who-for.tsx",
  ])("%s is no longer a client component", (path) => {
    const source = readSource(path);

    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("useTranslation");
    expect(source).toContain("getServerTranslation");
  });

  it.each([
    ["hero", MarketingHero, "Turn your knowledge into cash through a digital business."],
    ["how it works", HowItWorksStrip, "Three steps from your method to a published program."],
    ["capabilities", CapabilitiesGrid, "Everything your program needs is already built in."],
    ["promise", PromisePreviewBand, "Six commitments. Written down. Public."],
    ["for creators", ForCreatorsBand, "Teach beyond the limits of your live sessions."],
  ])(
    "%s still renders the translated text",
    async (_name, Section, text) => {
      render(await Section());

      expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    },
  );

  // Hierarchy: a section title is always smaller than the top title, at any
  // width, but never below 36px on the phone (the audience is 55+). Reads the
  // clamp() of each file and compares from 320 to 1920px (1rem = 16px).
  it("section titles stay below the top title at any width", () => {
    const clampOf = (path: string, tag: string) => {
      const match = readSource(path).match(
        new RegExp(`<${tag} className="[^"]*text-\\[clamp\\(([\\d.]+)rem,([\\d.]+)vw,([\\d.]+)rem\\)\\]`),
      );
      expect(match, `${path}: clamp of <${tag}> not found`).not.toBeNull();
      const [min, vw, max] = match!.slice(1).map(Number);
      return (width: number) => Math.min(Math.max(min * 16, (vw * width) / 100), max * 16);
    };
    const hero = clampOf("src/components/site/marketing-hero.tsx", "h1");
    for (const file of ["how-it-works-strip", "capabilities-grid", "promise-preview-band", "home-faq", "home-who-for", "for-creators-band"]) {
      const section = clampOf(`src/components/site/${file}.tsx`, "h2");
      for (let width = 320; width <= 1920; width += 8) {
        expect(section(width), `${file} at ${width}px`).toBeLessThan(hero(width));
        if (width < 640) expect(section(width), `${file} at ${width}px`).toBeGreaterThanOrEqual(36);
      }
    }
    // The numbers in the facts band are big, but never larger than the top title,
    // at any width.
    const figure = clampOf("src/components/site/home-facts-band.tsx", "dt");
    for (let width = 320; width <= 1920; width += 8) {
      expect(figure(width), `facts band number at ${width}px`).toBeLessThan(hero(width));
    }
  });

  // S-17: a card that opens nothing does not react to the mouse (moving up and changing the color
  // of the icon made it look like a button). The home-card class stays: it is what the
  // scroll choreography needs.
  it("the capability cards are not links and stay still on mouse hover", async () => {
    const { container } = render(await CapabilitiesGrid());

    const cards = container.querySelectorAll(".home-card > article");
    expect(cards).toHaveLength(6);
    for (const card of cards) {
      expect(card.querySelector("a")).toBeNull();
      expect(card.outerHTML).not.toMatch(/hover:/);
    }
  });

  // Inherited from marketing.test.tsx, which can no longer mount the section through the
  // home (async server component). The letter is still just one.
  it("the promise is still a single letter, on any screen", async () => {
    render(await PromisePreviewBand());

    expect(screen.getByText("Fee-lock for 24 months")).toBeInTheDocument();
    expect(
      screen.queryByText(/Export every course, student, sale, and post/),
    ).not.toBeInTheDocument();

    const card = screen
      .getByText("Public record · v1.0")
      .closest("div.relative.overflow-hidden");
    expect(card).not.toHaveClass("hidden");
    expect(
      screen.getByRole("link", { name: "Read the full Promise" }),
    ).toHaveAttribute("href", "/promise");
  });
});
