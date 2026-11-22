import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Botao desligado nao pode parecer clicavel. jsdom nao tem hover nem layout,
// entao o que se prova aqui e a REGRA do CSS (mesmo desenho de onda-d-motion).
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const variants = [
  "button-solid",
  "button-outline",
  "button-accent",
  "button-danger",
  "button-solid-light",
  "button-outline-light",
];
const rule = `:is(${variants.map((variant) => `.${variant}`).join(", ")}):is(:disabled, [aria-disabled="true"]) {`;

describe("botao desligado nao reage ao mouse nem ao clique", () => {
  it("fica parado, sem sombra e com o cursor de bloqueado", () => {
    const start = css.indexOf(rule);
    expect(start).toBeGreaterThan(-1);
    const body = css.slice(start, css.indexOf("}", start));
    expect(body).toContain("cursor: not-allowed;");
    expect(body).toContain("transform: none;");
    expect(body).toContain("box-shadow: none;");
  });

  // A regra tem a mesma especificidade dos :hover e :active de cada variante:
  // so vale porque vem depois deles. Mover um deles para baixo dela devolve o
  // botao desligado que sobe e afunda.
  it.each(variants)("vem depois do :hover de .%s e do afundar no clique", (variant) => {
    const start = css.indexOf(rule);
    const hover = css.indexOf(`.${variant}:hover {`);
    expect(hover).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(hover);
    expect(start).toBeGreaterThan(css.indexOf(".button-solid:active,"));
  });
});
