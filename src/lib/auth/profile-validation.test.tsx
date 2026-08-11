import { describe, expect, it } from "vitest";

import { maxCredentialEntries, maxCredentialLength } from "@/domain/user-profile";
import {
  formatValidationMessage,
  normalizeCredentials,
  normalizeGoals,
  normalizeUsername,
  validateBio,
  validateCredentials,
  validateDisplayName,
  validateUsername,
} from "@/lib/auth/profile-validation";

describe("normalizeUsername", () => {
  it("strips a leading @, trims, and lowercases", () => {
    expect(normalizeUsername("  @Ana_Souza  ")).toBe("ana_souza");
    expect(normalizeUsername("@@@ana")).toBe("ana");
  });
});

describe("validateUsername", () => {
  it("accepts a normalizable handle", () => {
    // Validation runs on the normalized value, so the form can accept what the
    // user typed and store the canonical form.
    expect(validateUsername("  @Ana-Souza ")).toBe("");
  });

  it("rejects an empty handle", () => {
    expect(validateUsername("   @  ")).toBe("profileValidation.usernameRequired");
  });

  it("rejects handles outside the storefront-safe shape", () => {
    // These become part of a public URL, so the pattern is deliberately narrow:
    // 3-32 chars, lowercase alnum + dash, never starting with a dash.
    expect(validateUsername("ab")).toBe("profileValidation.usernameInvalid");
    expect(validateUsername("-ana")).toBe("profileValidation.usernameInvalid");
    expect(validateUsername("ana souza")).toBe("profileValidation.usernameInvalid");
    expect(validateUsername("ana_souza")).toBe("profileValidation.usernameInvalid");
    expect(validateUsername("a".repeat(33))).toBe("profileValidation.usernameInvalid");
  });

  it("accepts the exact boundary lengths", () => {
    expect(validateUsername("abc")).toBe("");
    expect(validateUsername("a".repeat(32))).toBe("");
  });
});

describe("validateDisplayName", () => {
  it("measures the trimmed value, not the raw input", () => {
    expect(validateDisplayName("  a  ")).toBe("profileValidation.displayNameRequired");
    expect(validateDisplayName(" ab ")).toBe("");
  });

  it("caps at 120 characters", () => {
    expect(validateDisplayName("a".repeat(120))).toBe("");
    expect(validateDisplayName("a".repeat(121))).toBe(
      "profileValidation.displayNameTooLong",
    );
  });
});

describe("validateBio", () => {
  it("caps at 280 characters, trimmed", () => {
    expect(validateBio("")).toBe("");
    expect(validateBio("a".repeat(280))).toBe("");
    expect(validateBio(`  ${"a".repeat(280)}  `)).toBe("");
    expect(validateBio("a".repeat(281))).toBe("profileValidation.bioTooLong");
  });
});

describe("normalizeGoals", () => {
  it("keeps only known goals and drops anything else", () => {
    expect(normalizeGoals(["career_growth", "not_a_goal", "teach_online"])).toEqual([
      "career_growth",
      "teach_online",
    ]);
  });
});

describe("credentials", () => {
  it("normalizes by trimming and dropping blanks", () => {
    expect(normalizeCredentials(["  PhD  ", "", "   ", "CPA"])).toEqual(["PhD", "CPA"]);
  });

  it("truncates silently while the validator rejects loudly", () => {
    // Deliberate split: validateCredentials is what the form shows the user,
    // normalizeCredentials is the last-resort clamp before persisting. If the
    // two ever disagree on the limit, an over-limit list would save truncated
    // with no error shown.
    const tooMany = Array.from({ length: maxCredentialEntries + 1 }, (_, i) => `c${i}`);

    expect(normalizeCredentials(tooMany)).toHaveLength(maxCredentialEntries);
    expect(validateCredentials(tooMany)).toBe("profileValidation.credentialsTooMany");
  });

  it("accepts exactly the limit", () => {
    const atLimit = Array.from({ length: maxCredentialEntries }, (_, i) => `c${i}`);

    expect(validateCredentials(atLimit)).toBe("");
  });

  it("ignores blanks when counting", () => {
    const atLimit = Array.from({ length: maxCredentialEntries }, (_, i) => `c${i}`);

    expect(validateCredentials([...atLimit, "", "   "])).toBe("");
  });

  it("rejects a single over-long entry", () => {
    expect(validateCredentials(["a".repeat(maxCredentialLength)])).toBe("");
    expect(validateCredentials(["a".repeat(maxCredentialLength + 1)])).toBe(
      "profileValidation.credentialsTooLong",
    );
  });
});

describe("formatValidationMessage", () => {
  const t = (key: string) => `${key}:{max}`;

  it("passes an empty key straight through", () => {
    expect(formatValidationMessage("", t)).toBe("");
  });

  it("substitutes the length limit for the too-long message", () => {
    expect(formatValidationMessage("profileValidation.credentialsTooLong", t)).toBe(
      `profileValidation.credentialsTooLong:${maxCredentialLength}`,
    );
  });

  it("substitutes the entry limit for every other message", () => {
    // The two limits are different numbers (6 vs 120), so picking the wrong
    // branch shows the user a limit that isn't the one being enforced.
    expect(formatValidationMessage("profileValidation.credentialsTooMany", t)).toBe(
      `profileValidation.credentialsTooMany:${maxCredentialEntries}`,
    );
  });
});
