import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ForCreatorsBand } from "@/components/site/for-creators-band";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";

// Server component: o idioma vem do cookie.
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

describe("faixa final da home com foto", () => {
  // Dois cortes da mesma cena num <picture>: o navegador baixa só um. 3:4 no
  // celular; 12:5 do md para cima.
  it.each(dictionaries)("em %s usa o corte 3:4 no celular e o 12:5 do md para cima", async (locale, dict) => {
    const { image, sources } = await renderBand(locale);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toHaveAttribute("media", "(min-width: 768px)");
    expect(sources[0].getAttribute("srcset")).toContain(encodeURIComponent("/brand/home/home-cta-desktop.webp"));
    expect(image.getAttribute("src")).toContain(encodeURIComponent("/brand/home/home-cta-mobile.webp"));
    expect(image.getAttribute("srcset")).toContain(encodeURIComponent("/brand/home/home-cta-mobile.webp"));
    expect(image).toHaveAttribute("alt", dict.home.creators.photoAlt);
    // No fim da página: preguiçosa, nunca disputa com o topo.
    expect(image).toHaveAttribute("loading", "lazy");
  });

  // No celular o texto vem embaixo da foto, nunca branco por cima dela: o
  // quadro da foto não tem texto e só vira fundo (absolute) do lg para cima.
  it("no celular o texto vem depois da foto, fora do quadro dela", async () => {
    const { container, photo } = await renderBand("en");

    expect(photo.textContent).toBe("");
    expect(photo).toHaveClass("relative", "aspect-[3/4]", "md:aspect-[12/5]", "lg:absolute");
    expect(photo).not.toHaveClass("absolute");
    const lead = container.querySelector(".home-creators__lead")!;
    expect(photo.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(photo.contains(lead)).toBe(false);
  });

  // O resto da faixa não muda: título, os dois links de 48px, os planos e os
  // três itens, na ordem de sempre (a coreografia conta os itens por posição).
  it.each(dictionaries)("em %s guarda o título, os links e os quatro itens", async (locale, dict) => {
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

  // Peso no celular: as cinco fotos da home somam ~440 KB e não entra outra.
  it("as fotos da home cabem no orçamento", () => {
    const folder = join(process.cwd(), "public/brand/home");
    const files = readdirSync(folder);
    expect(files.sort()).toEqual([
      "home-cta-desktop.webp",
      "home-cta-mobile.webp",
      "home-who-coach.webp",
      "home-who-educator.webp",
      "home-who-teacher.webp",
    ]);
    const bytes = files.reduce((total, file) => total + statSync(join(folder, file)).size, 0);
    expect(bytes).toBeLessThanOrEqual(460 * 1024);
  });
});
