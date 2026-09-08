import { describe, expect, it } from "vitest";

import { countLabel } from "@/lib/i18n/count-label";

const dicionario: Record<string, string> = { one: "1 module", many: "{count} modules" };
const t = (key: string) => dicionario[key] ?? key;

describe("countLabel", () => {
  it("usa a chave do singular so quando a contagem e exatamente 1", () => {
    expect(countLabel(t, "one", "many", 1)).toBe("1 module");
    expect(countLabel(t, "one", "many", 0)).toBe("0 modules");
    expect(countLabel(t, "one", "many", 2)).toBe("2 modules");
  });
});
