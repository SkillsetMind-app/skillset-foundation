import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { linkify } from "@/lib/format/linkify";

// Texto do professor vira link sem dangerouslySetInnerHTML: so http(s), com a
// pontuacao do fim fora do link.
function show(text: string) {
  const { container } = render(<p>{linkify(text)}</p>);
  return container.querySelector("p") as HTMLElement;
}

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

  it("acha varios links e deixa parentese, virgula e exclamacao de fora", () => {
    const p = show("(https://a.com/x), e http://b.com/y?q=1!");

    expect(Array.from(p.querySelectorAll("a"), (a) => a.getAttribute("href"))).toEqual([
      "https://a.com/x",
      "http://b.com/y?q=1",
    ]);
    expect(p.textContent).toBe("(https://a.com/x), e http://b.com/y?q=1!");
  });
});
