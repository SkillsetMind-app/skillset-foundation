import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { platformNav } from "@/data/site";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// The teacher's money page (/account/payments) had four names:
// "Payments" (tour), "Earnings" (bar), "Payouts & tax" (page and avatar) and
// "Payouts panel" (errors). Now there is only one: "Earnings" / "Ganancias".

const NAME = { en: "Earnings", es: "Ganancias" } as const;
const OLD_NAMES = ["Payouts & tax", "Payouts panel", "Pagos e impuestos", "panel Cobros"];

function leaves(node: unknown, path = ""): Array<[string, string]> {
  if (typeof node === "string") return [[path, node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key));
}

describe("one name only for the money page", () => {
  it.each(["en", "es"] as const)("in %s, bar, group, shortcut and error use the same name", (locale) => {
    const dict = getDictionary(locale);

    for (const key of ["platform.nav.earnings", "platform.navSection.earnings", "teach.reports.linkEarnings"]) {
      expect(translate(dict, key), key).toBe(NAME[locale]);
    }
    // The teacher tour no longer mentions the page (O-11: it was left with two steps).
    expect(translate(dict, "creatorEditor.builder.errors.payouts")).toContain(NAME[locale]);
  });

  it.each(["en", "es"] as const)("in %s, none of the old names is left in the dictionary", (locale) => {
    const all = leaves(getDictionary(locale));

    for (const old of OLD_NAMES) {
      expect(all.filter(([, value]) => value.includes(old)).map(([path]) => path), old).toEqual([]);
    }
  });

  it("every navigation entry to /account/payments uses the same key, and so does the page", () => {
    const keys = new Set(platformNav.filter((item) => item.href === "/account/payments").map((item) => item.labelKey));
    expect([...keys]).toEqual(["platform.nav.earnings"]);

    const page = readFileSync("src/app/account/payments/page.tsx", "utf8");
    expect(page).toContain('privatePageMetadata("platform.nav.earnings")');
    expect(page).toContain('title={t("platform.nav.earnings")}');

    // The Earnings panel no longer repeats the name above the title (it was the generic
    // label of the sibling screens); the name stays in the bar, the menu and the tab.
    for (const file of ["src/components/site/account-menu.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toContain('t("platform.nav.earnings")');
    }
  });
});
