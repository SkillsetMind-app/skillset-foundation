import { describe, expect, it } from "vitest";

import { buyerCountryFromRequest, requiresWithdrawalConsent } from "@/lib/payments/withdrawal-consent";

describe("immediate access consent (EU, EEA and United Kingdom)", () => {
  it.each(["DE", "fr", "ES", "IE", "NO", "IS", "LI", "GB", "RE", "MQ", "AX"])("exige a caixa para %s", (country) => {
    expect(requiresWithdrawalConsent(country)).toBe(true);
  });

  it.each(["US", "BR", "CA", "CH", "", null, undefined])("does not require it for %s", (country) => {
    expect(requiresWithdrawalConsent(country)).toBe(false);
  });

  it("reads the country from the hosting header and ignores a strange value", () => {
    const from = (value?: string) =>
      buyerCountryFromRequest(new Request("http://localhost/", { headers: value === undefined ? {} : { "x-vercel-ip-country": value } }));
    expect(from("de")).toBe("DE");
    expect(from(" GB ")).toBe("GB");
    expect(from()).toBeNull();
    expect(from("Germany")).toBeNull();
  });
});
