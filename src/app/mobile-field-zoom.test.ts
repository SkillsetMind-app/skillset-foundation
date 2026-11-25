import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Safari on iPhone zooms in when a field with a font smaller than 16px gets
 * focus, and the zoom does NOT go back on its own: the person is left with the
 * screen shifted in the middle of the login, which is the first screen of the
 * product. No jsdom can catch this — it is real browser behavior —, so the
 * stylesheet is read as text.
 *
 * This test asserts the REQUIREMENT, not the implementation. The earlier
 * version of it lived in the audit folder and literally required `!important`
 * inside a `max-width` media query between 600 and 769px: it started failing
 * when the rule got better (the `!important` was unnecessary, and the width
 * range left the iPhone in landscape out). A test that locks in yesterday's
 * solution charges the price of today's fix.
 */
const css = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function blocosDeMedia(): string[] {
  const blocos: string[] = [];
  const abre = /@media([^{]*)\{/g;
  let match: RegExpExecArray | null;

  while ((match = abre.exec(css)) !== null) {
    const condicao = match[1];
    let profundidade = 1;
    let i = abre.lastIndex;

    while (i < css.length && profundidade > 0) {
      if (css[i] === "{") profundidade += 1;
      if (css[i] === "}") profundidade -= 1;
      i += 1;
    }

    blocos.push(`@media${condicao}{${css.slice(abre.lastIndex, i)}`);
  }

  return blocos;
}

describe("16px floor on form fields on the phone", () => {
  const pisos = blocosDeMedia().filter(
    (bloco) =>
      /(^|[\s,>])(input|textarea|select)\b/i.test(bloco)
      && /font-size:\s*16px/i.test(bloco),
  );

  it("there is a 16px floor for input, textarea and select", () => {
    expect(
      pisos.length,
      "no media query enforces 16px on fields — Safari on iOS will zoom on focus",
    ).toBeGreaterThan(0);

    const cobreOsTres = pisos.some(
      (bloco) =>
        /(^|[\s,>])input\b/i.test(bloco)
        && /(^|[\s,>])textarea\b/i.test(bloco)
        && /(^|[\s,>])select\b/i.test(bloco),
    );

    expect(
      cobreOsTres,
      "the floor exists but does not cover the three field types that trigger zoom",
    ).toBe(true);
  });

  it("applies by device type, not by screen width", () => {
    // The zoom comes from the field's font size and fires the same with the
    // iPhone in landscape, where the viewport is over 900px. A floor tied to
    // `max-width` leaves the login screen broken in landscape, which is how the
    // bug came back.
    const porAparelho = pisos.some(
      (bloco) => /pointer:\s*coarse/i.test(bloco) || /hover:\s*none/i.test(bloco),
    );

    expect(
      porAparelho,
      "the floor is tied to max-width; the iPhone in landscape (>900px) is left out and still zooms",
    ).toBe(true);
  });

  it("the .field-input skin (14px) does not break the floor on textarea and select", () => {
    // `.field-input` is (0,1,0) and beats `textarea`/`select` (0,0,1); the input
    // gets through because the floor's `:not()` gives (0,2,1). Without the
    // class reinforcement, the profile's Bio and Time zone stayed at 14px and
    // the iPhone zoomed.
    const cobre = pisos.some(
      (bloco) => /textarea\.field-input/.test(bloco) && /select\.field-input/.test(bloco),
    );

    expect(
      cobre,
      "the 16px floor does not reach textarea/select with .field-input — Safari on iOS will zoom",
    ).toBe(true);
  });

  it("does not need !important to beat the class rules", () => {
    // `input:not([type="checkbox"]):not([type="radio"])` is (0,2,1) and already
    // beats `.platform-sidebar-search input`, which is (0,1,1). A stylesheet
    // !important would trample every inline `style={{ fontSize }}` in the app
    // and would force the next legitimate override to be born with another.
    const comImportant = pisos.filter((bloco) =>
      /font-size:\s*16px\s*!important/i.test(bloco),
    );

    expect(
      comImportant,
      "the floor uses !important without needing it — it also overrides legitimate inline styles",
    ).toHaveLength(0);
  });
});
