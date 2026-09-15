import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { linkify } from "@/lib/format/linkify";

// Texto do professor vira link sem dangerouslySetInnerHTML: so http(s), com a
// pontuacao do fim fora do link.
function show(text: string) {
  const { container } = render(<p>{linkify(text)}</p>);
  return container.querySelector("p") as HTMLElement;
}

// Montados por codigo de proposito: nada de caractere invisivel no fonte.
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const RLM = String.fromCodePoint(0x200f);
const bidiControls = new RegExp("[\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]", "u");

describe("linkify", () => {
  it("vira link so o endereco, com o ponto final de fora", () => {
    const p = show("ver https://a.com/x.");
    const links = p.querySelectorAll("a");

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://a.com/x");
    expect(links[0]).toHaveTextContent("https://a.com/x");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
    expect(p.textContent).toBe("ver https://a.com/x.");
  });

  it.each(["javascript:alert(1)", "www.a.com", "data:text/html,<b>x</b>"])(
    "deixa %s como texto",
    (text) => {
      const p = show(text);

      expect(p.querySelector("a")).toBeNull();
      expect(p.textContent).toBe(text);
    },
  );

  // Com RLO (U+202E) o texto do link podia "ler" www.google.com enquanto o
  // href ia para evil.com (verificado num navegador real).
  it.each([
    [
      "antes da URL",
      `veja ${RLO}https://evil.com//moc.elgoog.www//:sptth`,
      "https://evil.com//moc.elgoog.www//:sptth",
    ],
    [
      "dentro da URL",
      `veja https://evil.com/${RLO}abc${LRI}d${RLM}`,
      "https://evil.com/abcd",
    ],
  ])("tira os controles bidi %s e isola o link em ltr", (_where, text, href) => {
    const p = show(text);
    const link = p.querySelector("a") as HTMLElement;

    // Garante que a entrada tem mesmo o controle (senao o teste nao prova nada).
    expect(text).toMatch(bidiControls);
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("dir", "ltr");
    expect(link.textContent).toBe(href);
    expect(link.textContent).not.toMatch(bidiControls);
    expect(p.textContent).not.toMatch(bidiControls);
  });

  it("acha varios links e deixa parentese, virgula e exclamacao de fora", () => {
    const p = show("(https://a.com/x), e http://b.com/y?q=1!");

    expect(Array.from(p.querySelectorAll("a"), (a) => a.getAttribute("href"))).toEqual([
      "https://a.com/x",
      "http://b.com/y?q=1",
    ]);
    expect(p.textContent).toBe("(https://a.com/x), e http://b.com/y?q=1!");
  });
});
