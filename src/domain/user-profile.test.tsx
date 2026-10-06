import { describe, expect, it } from "vitest";

import { instructorPagePath, isReservedHandle, isStorefrontHexColor, readableTextOnAccent } from "@/domain/user-profile";

describe("instructorPagePath", () => {
  it("usa /@usuario quando há @, senão /instructors/{uid}", () => {
    expect(instructorPagePath("u-1", "ana.souza")).toBe("/@ana.souza");
    expect(instructorPagePath("u-1", null)).toBe("/instructors/u-1");
  });

  // Um @ reservado responde 404 em /@...: o link cai no uid, que funciona.
  it("@ reservado cai no endereço pelo uid", () => {
    expect(instructorPagePath("u-1", "support")).toBe("/instructors/u-1");
  });
});

describe("isReservedHandle", () => {
  it("cobre os nomes que imitam a plataforma, sem diferenciar maiúsculas", () => {
    for (const handle of ["skillsetmind", "support", "admin", "help", "ops", "api", "team", "official", "staff", "security", "billing", "Support"]) {
      expect(isReservedHandle(handle), handle).toBe(true);
    }
    expect(isReservedHandle("ana.souza")).toBe(false);
  });
});

// A teacher picks this colour and it gets inlined into a CSS custom property.
// Two of the three call sites are render-time (member-area-shell, instructor-
// profile-view) and read from the world-readable public_profiles projection —
// so this is the gate that stops a stored string from becoming a style rule.
// The storefront panel also checks it on write, but that runs in the browser.
describe("isStorefrontHexColor", () => {
  it("accepts a full 6-digit hex in either case", () => {
    expect(isStorefrontHexColor("#a1b2c3")).toBe(true);
    expect(isStorefrontHexColor("#FFFFFF")).toBe(true);
    expect(isStorefrontHexColor("#AbCdEf")).toBe(true);
  });

  it("rejects anything trailing the colour", () => {
    // The end anchor is the whole point. Drop it and this first string closes
    // the custom property and appends a rule of the attacker's choosing.
    expect(
      isStorefrontHexColor("#ffffff; background: url(https://evil.example/x)"),
    ).toBe(false);
    expect(isStorefrontHexColor("#ffffff}")).toBe(false);
    expect(isStorefrontHexColor("#ffffff\n;color:red")).toBe(false);
    // JS `$` (no `m` flag) does not match before a trailing newline, unlike
    // some other regex flavours. Pinned so a port never quietly relaxes it.
    expect(isStorefrontHexColor("#ffffff\n")).toBe(false);
  });

  it("rejects shapes that are not exactly six hex digits", () => {
    expect(isStorefrontHexColor("#fff")).toBe(false);
    expect(isStorefrontHexColor("#aabbccdd")).toBe(false);
    expect(isStorefrontHexColor("aabbcc")).toBe(false);
    expect(isStorefrontHexColor("#gggggg")).toBe(false);
    expect(isStorefrontHexColor("red")).toBe(false);
    expect(isStorefrontHexColor("")).toBe(false);
    expect(isStorefrontHexColor(" #aabbcc")).toBe(false);
  });
});

// O acento do professor vira FUNDO de botao com texto por cima. Branco fixo
// em cima de um amarelo (#f5c518) dava 1,6:1. O texto sai do contraste WCAG
// do proprio acento: branco ou tinta escura, o que ler melhor.
describe("readableTextOnAccent", () => {
  it("keeps white on the platform red and on black", () => {
    expect(readableTextOnAccent("#b22234")).toBe("#ffffff");
    expect(readableTextOnAccent("#000000")).toBe("#ffffff");
  });

  it("switches to dark ink on light accents", () => {
    expect(readableTextOnAccent("#f5c518")).toBe("#0a0d12");
    expect(readableTextOnAccent("#ffffff")).toBe("#0a0d12");
    expect(readableTextOnAccent("#FFFFFF")).toBe("#0a0d12");
  });
});
