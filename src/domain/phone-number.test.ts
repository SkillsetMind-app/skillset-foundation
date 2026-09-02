import { describe, expect, it } from "vitest";

import { isValidPhoneNumber } from "@/domain/user-profile";

// O telefone do perfil aceita o jeito que a pessoa escreve; o que conta sao os
// digitos (8 a 15).
describe("isValidPhoneNumber", () => {
  it("aceita formatos do dia a dia", () => {
    expect(isValidPhoneNumber("+55 (16) 99999-1234")).toBe(true);
    expect(isValidPhoneNumber("16999991234")).toBe(true);
    expect(isValidPhoneNumber("+1 555 123 4567")).toBe(true);
  });

  it("recusa curto demais, longo demais e sem numero", () => {
    expect(isValidPhoneNumber("1234567")).toBe(false);
    expect(isValidPhoneNumber("1234567890123456")).toBe(false);
    expect(isValidPhoneNumber("")).toBe(false);
    expect(isValidPhoneNumber("meu telefone")).toBe(false);
  });
});
