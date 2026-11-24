import { describe, expect, it } from "vitest";

import { buyerCountryFromRequest, requiresWithdrawalConsent } from "@/lib/payments/withdrawal-consent";

describe("consentimento de acesso imediato (UE, EEE e Reino Unido)", () => {
  it.each(["DE", "fr", "ES", "IE", "NO", "IS", "LI", "GB", "RE", "MQ", "AX"])("exige a caixa para %s", (country) => {
    expect(requiresWithdrawalConsent(country)).toBe(true);
  });

  it.each(["US", "BR", "CA", "CH", "", null, undefined])("não exige para %s", (country) => {
    expect(requiresWithdrawalConsent(country)).toBe(false);
  });

  it("lê o país do cabeçalho da hospedagem e ignora valor estranho", () => {
    const from = (value?: string) =>
      buyerCountryFromRequest(new Request("http://localhost/", { headers: value === undefined ? {} : { "x-vercel-ip-country": value } }));
    expect(from("de")).toBe("DE");
    expect(from(" GB ")).toBe("GB");
    expect(from()).toBeNull();
    expect(from("Germany")).toBeNull();
  });
});
