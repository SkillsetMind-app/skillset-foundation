import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeWhoFor } from "@/components/site/home-who-for";
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

async function renderStrip(locale: string) {
  state.locale = locale;
  return render(await HomeWhoFor());
}

describe("faixa 'para quem é' da home", () => {
  // Nenhuma frase nova: o título é o público da faixa final e a linha é a do
  // topo sobre psicólogos que ensinam. Fora isso, só fotos.
  it.each(dictionaries)("em %s mostra só frases que o site já publica", async (locale, dict) => {
    const { container } = await renderStrip(locale);

    const section = container.querySelector("section")!;
    const title = container.querySelector(`#${section.getAttribute("aria-labelledby")}`);
    expect(title?.tagName).toBe("H2");
    expect(title?.textContent).toBe(dict.home.creators.eyebrow);
    expect(container.textContent).toBe(`${dict.home.creators.eyebrow}${dict.home.hero.alsoFor}`);
  });

  // As pessoas das fotos não existem (IA): nada de nome, citação, legenda ou
  // link que as apresente como clientes. O texto alternativo descreve a cena.
  it.each(dictionaries)("em %s os três retratos descrevem a cena, sem apresentar ninguém", async (locale, dict) => {
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

  // Bem abaixo do topo: carregam preguiçosas, com tamanho declarado, e o
  // arquivo existe em public/.
  it("os retratos carregam preguiçosos, com tamanho declarado", async () => {
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

  // Título na escala das outras seções (o clamp é conferido contra o do topo
  // em site-frame.test.tsx) e componente de servidor.
  it("é componente de servidor e usa o título das seções vizinhas", () => {
    const source = readFileSync(join(process.cwd(), "src/components/site/home-who-for.tsx"), "utf8");
    expect(source).not.toContain('"use client"');
    expect(source).toContain('<h2 className="display-title text-[clamp(2.25rem,4.2vw,3.25rem)]');
  });
});
