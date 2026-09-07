import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MembersAreaHero } from "@/components/learn/members-area-hero";

describe("MembersAreaHero", () => {
  it("renders the title and reflects the theme prop", () => {
    const { container } = render(
      <MembersAreaHero theme="light" title="Brand Design Atelier" />,
    );

    expect(screen.getByText("Brand Design Atelier")).toBeInTheDocument();
    expect(
      container.querySelector('[data-members-theme="light"]'),
    ).not.toBeNull();
  });

  it("renders fallback art (not a broken img) when no cover is set", () => {
    const { container } = render(
      <MembersAreaHero
        theme="dark"
        title="Untitled"
        studioName="Marie Curie Studio"
      />,
    );

    expect(container.querySelector(".members-hero__cover")).toBeNull();
    expect(container.querySelector(".members-hero__art")).not.toBeNull();
    expect(screen.getByText("MC")).toBeInTheDocument();
  });

  it("omits the progress bar when progressPercent is null", () => {
    const { container, rerender } = render(
      <MembersAreaHero theme="dark" title="Course" progressPercent={null} />,
    );
    expect(container.querySelector(".members-hero__prog")).toBeNull();

    rerender(
      <MembersAreaHero theme="dark" title="Course" progressPercent={42} />,
    );
    expect(container.querySelector(".members-hero__prog")).not.toBeNull();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});

// jsdom não faz layout: o encaixe no canvas é regra de CSS, e a única forma de
// prendê-la é ler a folha — o mesmo padrão de theme-tokens.test.tsx.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} não está em globals.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("MembersAreaHero — encaixe no canvas do desktop", () => {
  // Medido em produção (07/09, 1920×912): o hero tinha 520px na prática, os
  // mesmos em 1366×768, e empurrava a faixa "Preview mode" e as abas para fora
  // da tela. A altura agora é uma fatia do viewport, com piso e teto.
  it("tem altura proporcional ao viewport, não 520px fixos", () => {
    const hero = rule(".members-hero");
    expect(hero).toMatch(/min-height:\s*clamp\(300px, min\(43vw, 48svh\), 520px\)/);
    expect(hero).not.toMatch(/(?:^|\s)height:/);
  });

  it("deixa o celular como estava: abaixo de 980px a caixa segue o conteúdo", () => {
    expect(css).toMatch(/@media \(max-width: 980px\) \{\s*\.members-hero \{\s*min-height: 0;/);
  });

  it("corta a capa preservando o terço superior, onde ficam os rostos", () => {
    const { container } = render(
      <MembersAreaHero theme="dark" title="Course" coverUrl="https://cdn.test/cover.jpg" />,
    );
    expect(container.querySelector("img.members-hero__cover")).not.toBeNull();
    expect(rule(".members-hero__cover")).toMatch(/object-position:\s*50% 20%/);
  });

  it("ancora o texto na base do hero, com respiro de 40px", () => {
    const { container } = render(<MembersAreaHero theme="dark" title="Course" />);
    expect(container.querySelector(".members-hero__inner")).not.toBeNull();
    const inner = rule(".members-hero__inner");
    expect(inner).toMatch(/align-self:\s*flex-end/);
    expect(inner).toMatch(/padding:\s*40px 56px/);
  });

  it("escurece a base o bastante para texto branco ler sobre qualquer foto", () => {
    // Pior caso, foto branca. Escuro: rgba(7,9,13,.92) sobre #fff dá (27,29,32)
    // → 16.9:1 no título, 11.7:1 na descrição a 82% de branco. Claro:
    // rgba(8,20,38,.86) → (43,53,68) → ~12:1 e ~9:1. AA pede 4.5:1, e o
    // gradiente horizontal ainda soma por cima. Abaixo de 0.85 a conta falha.
    for (const theme of ["dark", "light"]) {
      const scrim = rule(`[data-members-theme="${theme}"]`).match(/--ma-hero-scrim:([^;]+);/)?.[1];
      expect(scrim, `${theme} sem --ma-hero-scrim`).toBeTruthy();
      const bottom = /linear-gradient\(0deg,\s*rgba\(\d+, \d+, \d+, (0\.\d+)\)/.exec(scrim!);
      expect(bottom, `${theme}: gradiente vertical sem parada inicial`).not.toBeNull();
      expect(Number(bottom![1]), theme).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("dá ao 'ver mais' um alvo de 44px", () => {
    expect(rule(".members-hero__more")).toMatch(/min-height:\s*44px/);
  });
});
