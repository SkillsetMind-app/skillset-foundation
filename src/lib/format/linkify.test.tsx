import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { linkify } from "@/lib/format/linkify";

// A teacher's text becomes a link without dangerouslySetInnerHTML: only http(s), with the
// trailing punctuation outside the link.
function show(text: string) {
  const { container } = render(<p>{linkify(text)}</p>);
  return container.querySelector("p") as HTMLElement;
}

// Built from code on purpose: no invisible character in the source.
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const RLM = String.fromCodePoint(0x200f);
const bidiControls = new RegExp("[\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]", "u");

describe("linkify", () => {
  it("only the address becomes a link, with the final period left out", () => {
    const p = show("see https://a.com/x.");
    const links = p.querySelectorAll("a");

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://a.com/x");
    expect(links[0]).toHaveTextContent("https://a.com/x");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
    expect(p.textContent).toBe("see https://a.com/x.");
  });

  it.each(["javascript:alert(1)", "www.a.com", "data:text/html,<b>x</b>"])(
    "leaves %s as text",
    (text) => {
      const p = show(text);

      expect(p.querySelector("a")).toBeNull();
      expect(p.textContent).toBe(text);
    },
  );

  // With RLO (U+202E) the link text could "read" www.google.com while the
  // href went to evil.com (verified in a real browser).
  it.each([
    [
      "before the URL",
      `see ${RLO}https://evil.com//moc.elgoog.www//:sptth`,
      "https://evil.com//moc.elgoog.www//:sptth",
    ],
    [
      "inside the URL",
      `see https://evil.com/${RLO}abc${LRI}d${RLM}`,
      "https://evil.com/abcd",
    ],
  ])("strips the bidi controls %s and isolates the link in ltr", (_where, text, href) => {
    const p = show(text);
    const link = p.querySelector("a") as HTMLElement;

    // Makes sure the input really has the control (otherwise the test proves nothing).
    expect(text).toMatch(bidiControls);
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("dir", "ltr");
    expect(link.textContent).toBe(href);
    expect(link.textContent).not.toMatch(bidiControls);
    expect(p.textContent).not.toMatch(bidiControls);
  });

  it("finds several links and leaves the parenthesis, comma and exclamation mark out", () => {
    const p = show("(https://a.com/x), and http://b.com/y?q=1!");

    expect(Array.from(p.querySelectorAll("a"), (a) => a.getAttribute("href"))).toEqual([
      "https://a.com/x",
      "http://b.com/y?q=1",
    ]);
    expect(p.textContent).toBe("(https://a.com/x), and http://b.com/y?q=1!");
  });
});
