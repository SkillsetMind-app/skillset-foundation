import { describe, expect, it } from "vitest";

import { isStorefrontHexColor } from "@/domain/user-profile";

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
