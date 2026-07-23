import { describe, expect, it } from "vitest";

import { toPlainProse } from "./plain-prose";

describe("toPlainProse", () => {
  it("strips bold and italic markers", () => {
    expect(toPlainProse("Use a **strong** hook and *keep* it short.")).toBe(
      "Use a strong hook and keep it short.",
    );
    expect(toPlainProse("This is __really__ good.")).toBe("This is really good.");
  });

  it("removes heading and blockquote markers", () => {
    expect(toPlainProse("## Pricing\nStart at $49.")).toBe("Pricing\nStart at $49.");
    expect(toPlainProse("> a quoted tip")).toBe("a quoted tip");
  });

  it("turns markdown bullets into plain bullets", () => {
    expect(toPlainProse("- first\n- second")).toBe("• first\n• second");
    expect(toPlainProse("* star bullet")).toBe("• star bullet");
  });

  it("converts em/en dashes to commas but keeps hyphens", () => {
    expect(toPlainProse("Do this — then that.")).toBe("Do this, then that.");
    expect(toPlainProse("a first-class one-on-one call")).toBe(
      "a first-class one-on-one call",
    );
  });

  it("preserves snake_case and URLs", () => {
    expect(toPlainProse("Set my_env_var in the panel.")).toBe(
      "Set my_env_var in the panel.",
    );
    expect(toPlainProse("[the docs](https://x.io/a_b)")).toBe(
      "the docs (https://x.io/a_b)",
    );
  });

  it("drops code backticks and trims", () => {
    expect(toPlainProse("Run `npm run dev`.  ")).toBe("Run npm run dev.");
  });

  it("returns empty string for empty input", () => {
    expect(toPlainProse("")).toBe("");
  });
});
