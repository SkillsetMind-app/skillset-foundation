import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeWhoFor } from "@/components/site/home-who-for";
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

async function renderStrip(locale: string) {
  state.locale = locale;
  return render(await HomeWhoFor());
}

describe("home 'who it is for' band", () => {
  // No new sentence: the title is the audience of the final band. Apart from that, only
  // photos (the line about psychologists who teach stays only at the top of the home).
  it.each(dictionaries)("in %s shows only sentences the site already publishes", async (locale, dict) => {
    const { container } = await renderStrip(locale);

    const section = container.querySelector("section")!;
    const title = container.querySelector(`#${section.getAttribute("aria-labelledby")}`);
    expect(title?.tagName).toBe("H2");
    expect(title?.textContent).toBe(dict.home.creators.eyebrow);
    expect(container.textContent).toBe(dict.home.creators.eyebrow);
  });

  // The people in the photos do not exist (AI): no name, quote, caption or
  // link that presents them as customers. The alt text describes the scene.
  it.each(dictionaries)("in %s the three portraits describe the scene, without introducing anyone", async (locale, dict) => {
    const { container } = await renderStrip(locale);

    expect(container.querySelector("a, blockquote, q, figcaption, cite")).toBeNull();
    const images = [...container.querySelectorAll("img")];
    expect(images.map((image) => image.getAttribute("alt"))).toEqual([
      dict.home.who.coachAlt,
      dict.home.who.teacherAlt,
      dict.home.who.educatorAlt,
    ]);
    for (const image of images) {
      expect(image.getAttribute("alt")).toMatch(/^(A|An|Un|Una) /);
      expect(image.getAttribute("alt")).not.toMatch(/\bour\b|nuestr/i);
    }
  });

  // Well below the top: they load lazily, with a declared size, and the
  // file exists in public/.
  it("the portraits load lazily, with a declared size", async () => {
    const { container } = await renderStrip("en");

    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(3);
    ["coach", "teacher", "educator"].forEach((name, index) => {
      const image = images[index];
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image.getAttribute("sizes")).toContain("100vw");
      expect(image.getAttribute("src")).toContain(encodeURIComponent(`/brand/home/home-who-${name}.avif`));
      expect(existsSync(join(process.cwd(), "public/brand/home", `home-who-${name}.avif`)), name).toBe(true);
    });
  });

  // Title at the scale of the other sections (the clamp is checked against the top's
  // in site-frame.test.tsx) and a server component.
  it("is a server component and uses the title of the neighboring sections", () => {
    const source = readFileSync(join(process.cwd(), "src/components/site/home-who-for.tsx"), "utf8");
    expect(source).not.toContain('"use client"');
    expect(source).toContain('<h2 className="display-title text-[clamp(2.25rem,4.2vw,3.25rem)]');
  });
});
