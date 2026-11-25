import { describe, expect, it, vi } from "vitest";

import { LOCALE_COOKIE } from "@/lib/i18n/config";
import { buildPageMetadata, SITE_URL } from "@/lib/seo/page-metadata";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "es" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === LOCALE_COOKIE ? { value: state.locale } : undefined),
  }),
}));

describe("buildPageMetadata — canonical host", () => {
  // Production serves `www`: the apex answers 301 to it. While SITE_URL
  // pointed to the apex, every page declared itself canonical at an address that
  // redirects, and the whole sitemap listed redirected URLs — a search engine
  // treats a redirect as a weakened signal.
  it("uses www, not the apex that redirects", () => {
    expect(SITE_URL).toBe("https://www.skillsetmind.com");
  });

  it("builds canonical and og:url on the canonical host", () => {
    const meta = buildPageMetadata({
      title: "Curso",
      description: "Descrição",
      path: "/courses/abc",
    });

    expect(meta.alternates?.canonical).toBe(
      "https://www.skillsetmind.com/courses/abc",
    );
    expect(meta.openGraph?.url).toBe("https://www.skillsetmind.com/courses/abc");
  });
});

describe("buildPageMetadata — card image", () => {
  // Before, og:image was ALWAYS the brand logo: every course in the catalog
  // produced a visually identical share card.
  it("uses the course cover when it is an absolute URL", () => {
    const cover = "https://cdn.example.com/capa.jpg";
    const meta = buildPageMetadata({
      title: "Curso",
      description: "Descrição",
      path: "/courses/abc",
      image: cover,
    });

    expect(meta.openGraph?.images).toEqual([{ url: cover }]);
    expect(meta.twitter?.images).toEqual([cover]);
  });

  it("resolves a local path against the canonical host", () => {
    const meta = buildPageMetadata({
      title: "Curso",
      description: "Descrição",
      path: "/courses/abc",
      image: "/brand/capa.png",
    });

    expect(meta.openGraph?.images).toEqual([
      { url: "https://www.skillsetmind.com/brand/capa.png" },
    ]);
  });

  // The default was the 1600×320 logo on a large card: WhatsApp and LinkedIn cut
  // the logo in half. The default is now the 1200×630 card from src/app/opengraph-image.
  it("falls back to the 1200×630 share card when the page has no image of its own", () => {
    const withoutImage = buildPageMetadata({
      title: "Sobre",
      description: "Descrição",
      path: "/about",
    });
    const withNull = buildPageMetadata({
      title: "Sobre",
      description: "Descrição",
      path: "/about",
      image: null,
    });
    const card = `${SITE_URL}/opengraph-image`;

    expect(withoutImage.openGraph?.images).toEqual(withNull.openGraph?.images);
    expect(withoutImage.openGraph?.images).toEqual([{ url: card, width: 1200, height: 630 }]);
    expect(withoutImage.twitter?.images).toEqual([card]);
  });
});

describe("privatePageMetadata — header of a logged-in page", () => {
  // Pages behind login (/account, /learn, /teach) have no title
  // of their own: the browser tab falls back to the root layout's generic title. The
  // helper reuses the SAME label the page already shows via
  // `PlatformShell title={t(key)}`, in the cookie's language, with the brand
  // suffix — no canonical/Open Graph, the page requires login.
  it.each([
    ["en", "Settings | SkillsetMind"],
    ["es", "Configuración | SkillsetMind"],
  ])("translates the label and adds the brand suffix (%s)", async (locale, title) => {
    state.locale = locale as "en" | "es";
    expect(await privatePageMetadata("accountSettings.label")).toEqual({
      title,
      robots: { index: false, follow: false },
    });
  });

  // A title that ends in a period ("Build, ship, get paid."): in the tab, the period
  // before the separator looks like a typo. (The headers of the teacher
  // screens lost the period; this label still has it.)
  it.each([
    ["en", "Build, ship, get paid | SkillsetMind"],
    ["es", "Crea, publica, cobra | SkillsetMind"],
  ])("drops the header's final period from the tab title (%s)", async (locale, title) => {
    state.locale = locale as "en" | "es";
    expect((await privatePageMetadata("teach.page.title")).title).toBe(title);
  });
});
