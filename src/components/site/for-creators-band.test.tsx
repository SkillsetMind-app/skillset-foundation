import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ForCreatorsBand } from "@/components/site/for-creators-band";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";

// Server component: the language comes from the cookie.
const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.locale }) }) }));

afterEach(() => {
  cleanup();
  state.locale = "en";
});

const dictionaries = [["en", en], ["es", es]] as const;

async function renderBand(locale: string) {
  state.locale = locale;
  const { container } = render(await ForCreatorsBand());
  const photo = container.querySelector<HTMLElement>(".home-creators__photo")!;
  return { container, photo, image: photo.querySelector("img")!, sources: [...photo.querySelectorAll("picture > source")] };
}

describe("final home band with photo", () => {
  // Two crops of the same scene in a <picture>: the browser downloads only one.
  // 3:4 on phones; 12:5 from md up.
  it.each(dictionaries)("in %s uses the 3:4 crop on phones and the 12:5 crop from md up", async (locale, dict) => {
    const { image, sources } = await renderBand(locale);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toHaveAttribute("media", "(min-width: 48rem)");
    expect(sources[0].getAttribute("srcset")).toContain(encodeURIComponent("/brand/home/home-cta-desktop.avif"));
    expect(image.getAttribute("src")).toContain(encodeURIComponent("/brand/home/home-cta-mobile.avif"));
    expect(image.getAttribute("srcset")).toContain(encodeURIComponent("/brand/home/home-cta-mobile.avif"));
    expect(image).toHaveAttribute("alt", dict.home.creators.photoAlt);
    // At the end of the page: lazy, never competes with the top.
    expect(image).toHaveAttribute("loading", "lazy");
  });

  // On phones the text sits below the photo, never white on top of it: the
  // photo frame has no text and only becomes a background (absolute) from lg up.
  it("on phones the text comes after the photo, outside its frame", async () => {
    const { container, photo } = await renderBand("en");

    expect(photo.textContent).toBe("");
    expect(photo).toHaveClass("relative", "aspect-[3/4]", "md:aspect-[12/5]", "lg:absolute");
    expect(photo).not.toHaveClass("absolute");
    const lead = container.querySelector(".home-creators__lead")!;
    expect(photo.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(photo.contains(lead)).toBe(false);
  });

  // The rest of the band does not change: title, the two 48px links, the plans
  // and the three items, in the usual order (the choreography counts the items by position).
  it.each(dictionaries)("in %s keeps the title, the links and the four items", async (locale, dict) => {
    const { container } = await renderBand(locale);

    expect(container.querySelector(".home-creators__lead h2")?.textContent).toBe(dict.home.creators.title);
    const links = [...container.querySelectorAll(".home-creators__lead a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/auth?mode=signup&path=teacher", "/promise"]);
    for (const link of links) expect(link).toHaveClass("min-h-12");
    const items = [...container.querySelectorAll(".home-creators__item")];
    expect(items).toHaveLength(4);
    expect(new Set(items.map((item) => item.parentElement)).size).toBe(1);
    expect(items[0].textContent).toContain(dict.home.creators.plansLabel);
    expect(items.slice(1).map((item) => item.textContent)).toEqual([
      dict.home.creators.bullet2,
      dict.home.creators.bullet3,
      dict.home.creators.bullet4,
    ]);
  });

  // Weight on phones: the five home photos add up to ~440 KB and no other goes in.
  it("as fotos da home cabem no orçamento", () => {
    const folder = join(process.cwd(), "public/brand/home");
    const files = readdirSync(folder);
    expect(files.sort()).toEqual([
      "home-cta-desktop.avif",
      "home-cta-mobile.avif",
      "home-who-coach.avif",
      "home-who-educator.avif",
      "home-who-teacher.avif",
    ]);
    const bytes = files.reduce((total, file) => total + statSync(join(folder, file)).size, 0);
    expect(bytes).toBeLessThanOrEqual(460 * 1024);
  });
});
