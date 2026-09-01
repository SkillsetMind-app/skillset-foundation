import { describe, expect, it } from "vitest";

import { maxCredentialEntries, maxCredentialLength } from "@/domain/user-profile";
import {
  deriveUsername,
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

describe("deriveUsername", () => {
  // The bug: signup derived the handle with normalizeUsername, which only
  // lowercases and strips the "@", so "Patrick Simon" became "patrick simon" —
  // a space — and validateUsername refuses that. Everyone with a compound name
  // got an invalid handle written on day one.
  it.each([
    ["Patrick Simon", "patrick-simon"],
    ["  Ana   Souza  ", "ana-souza"],
    ["José da Silva", "jose-da-silva"],
    ["Zoë 🚀 Müller", "zoe-muller"],
    ["@Ana_Souza.dev", "ana-souza-dev"],
    ["Jean-Luc Picard", "jean-luc-picard"],
  ])("shapes %j into %j", (displayName, expected) => {
    expect(deriveUsername(displayName, "someone@example.com")).toBe(expected);
  });

  it("cuts at 32 without ending on a hyphen", () => {
    // 10 + 1 + 10 + 1 + 9 + 1 = 32: the cut lands right after a hyphen.
    const handle = deriveUsername("abcdefghij klmnopqrst uvwxyzabc defg", "x@y.z");

    expect(handle).toBe("abcdefghij-klmnopqrst-uvwxyzabc");
    expect(deriveUsername("a".repeat(50), "x@y.z")).toBe("a".repeat(32));
  });

  it("falls back to the e-mail's local part when the name is too short", () => {
    expect(deriveUsername("Li", "li.wang+courses@example.com")).toBe("li-wang-courses");
  });

  it("returns null when nothing usable is left — the handle is optional", () => {
    expect(deriveUsername("A", "a@example.com")).toBeNull();
    expect(deriveUsername("李小龍", "李@example.com")).toBeNull();
    expect(deriveUsername("🚀🚀🚀", "!!@example.com")).toBeNull();
  });

  it("never hands back something validateUsername would refuse", () => {
    const inputs: [string, string][] = [
      ["Patrick Simon", "p@x.y"],
      ["  --weird--  ", "weird@x.y"],
      ["a".repeat(50), "z@x.y"],
      ["Ünïcödé Nämé", "u@x.y"],
      ["Li", "li.wang+courses@example.com"],
    ];

    for (const [displayName, email] of inputs) {
      const handle = deriveUsername(displayName, email);

      expect(handle).not.toBeNull();
      expect(validateUsername(handle as string)).toBe("");
    }
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
