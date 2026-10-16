import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { platformNav } from "@/data/site";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// A pagina do dinheiro do professor (/account/payments) tinha quatro nomes:
// "Payments" (tour), "Earnings" (barra), "Payouts & tax" (pagina e avatar) e
// "Payouts panel" (erros). Agora e um so: "Earnings" / "Ganancias".

const NAME = { en: "Earnings", es: "Ganancias" } as const;
const OLD_NAMES = ["Payouts & tax", "Payouts panel", "Pagos e impuestos", "panel Cobros"];

function leaves(node: unknown, path = ""): Array<[string, string]> {
  if (typeof node === "string") return [[path, node]];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key));
}

describe("um nome so para a pagina do dinheiro", () => {
  it.each(["en", "es"] as const)("em %s, barra, grupo, atalho e tour usam o mesmo nome", (locale) => {
    const dict = getDictionary(locale);

    for (const key of ["platform.nav.earnings", "platform.navSection.earnings", "teach.reports.linkEarnings"]) {
      expect(translate(dict, key), key).toBe(NAME[locale]);
    }
    expect(translate(dict, "teach.tour.step4Body")).toContain(NAME[locale]);
    expect(translate(dict, "creatorEditor.builder.errors.payouts")).toContain(NAME[locale]);
  });

  it.each(["en", "es"] as const)("em %s, nenhum dos nomes antigos sobrou no dicionario", (locale) => {
    const all = leaves(getDictionary(locale));

    for (const old of OLD_NAMES) {
      expect(all.filter(([, value]) => value.includes(old)).map(([path]) => path), old).toEqual([]);
    }
  });

  it("toda entrada da navegacao para /account/payments usa a mesma chave, e a pagina tambem", () => {
    const keys = new Set(platformNav.filter((item) => item.href === "/account/payments").map((item) => item.labelKey));
    expect([...keys]).toEqual(["platform.nav.earnings"]);

    const page = readFileSync("src/app/account/payments/page.tsx", "utf8");
    expect(page).toContain('privatePageMetadata("platform.nav.earnings")');
    expect(page).toContain('title={t("platform.nav.earnings")}');

    for (const file of ["src/components/site/account-menu.tsx", "src/components/teacher/teacher-wallet-panel.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toContain('t("platform.nav.earnings")');
    }
  });
});
