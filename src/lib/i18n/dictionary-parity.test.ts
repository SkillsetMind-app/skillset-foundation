import { describe, expect, it } from "vitest";

import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";

// The type of es.json is checked against en.json at compile time, but only for
// missing keys. A Spanish entry with an extra key or a renamed placeholder
// ("{nombre}" instead of "{name}") compiles and then renders the raw marker.
type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = "", out: Record<string, string> = {}) {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else flatten(value, path, out);
  }
  return out;
}

const markers = (text: string) => (text.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort().join(" ");

describe("dicionarios EN/ES", () => {
  const english = flatten(en as Tree);
  const spanish = flatten(es as Tree);

  it("espanhol tem exatamente as chaves do ingles", () => {
    expect(Object.keys(english).filter((key) => !(key in spanish))).toEqual([]);
    expect(Object.keys(spanish).filter((key) => !(key in english))).toEqual([]);
  });

  it("cada traducao preserva os marcadores de interpolacao", () => {
    const broken = Object.keys(english).filter(
      (key) => key in spanish && markers(english[key]) !== markers(spanish[key]),
    );
    expect(broken).toEqual([]);
  });
});
