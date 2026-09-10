import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  getPasswordRequirementState,
  isStrongPassword,
  PasswordStrengthChecklist,
} from "@/components/auth/password-strength-checklist";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

describe("password requirements", () => {
  afterEach(cleanup);

  it.each([...punctuation])("counts printable ASCII punctuation %j as special", (special) => {
    const password = `Abcdef1${special}`;
    expect(getPasswordRequirementState(password).find(({ id }) => id === "special")?.met).toBe(true);
    expect(isStrongPassword(password)).toBe(true);
  });

  it("does not count any other ASCII character, Unicode, or whitespace as special", () => {
    const nonPunctuation = [
      ...Array.from({ length: 128 }, (_, code) => String.fromCharCode(code))
        .filter((character) => !punctuation.includes(character)),
      "\u00e9", "\u00a0", "\u200b", "\u2014", "\ud83d\ude80",
    ];
    for (const character of nonPunctuation) {
      expect(isStrongPassword(`Abcdef1${character}`)).toBe(false);
    }
  });

  it.each([
    ["Abcde1.", "length"],
    ["abcdef1.", "uppercase"],
    ["ABCDEF1.", "lowercase"],
    ["Abcdefg.", "number"],
    ["Abcdef12", "special"],
  ])("still rejects %j when %s is missing", (password, missing) => {
    expect(isStrongPassword(password)).toBe(false);
    expect(getPasswordRequirementState(password).filter(({ met }) => !met).map(({ id }) => id)).toEqual([missing]);
  });

  it("keeps empty passwords invalid and does not trim passwords", () => {
    expect(getPasswordRequirementState("").every(({ met }) => !met)).toBe(true);
    expect(getPasswordRequirementState(" Abcd1.").find(({ id }) => id === "length")?.met).toBe(false);
    expect(getPasswordRequirementState(" Abcd1. ").find(({ id }) => id === "length")?.met).toBe(true);
  });

  it("renders the same special-character state used to gate password submission", () => {
    const label = translate(getDictionary("en"), "authFlow.passwordRules.special");
    const { rerender } = render(<PasswordStrengthChecklist password="Abcdef1 " />);
    expect(screen.getByText(label)).not.toHaveClass("line-through");

    for (const special of [".", "-", "_"]) {
      rerender(<PasswordStrengthChecklist password={`Abcdef1${special}`} />);
      expect(screen.getByText(label)).toHaveClass("line-through");
      expect(screen.getAllByRole("listitem")).toHaveLength(5);
    }
  });
});
