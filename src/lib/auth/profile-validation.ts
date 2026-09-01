import type { UserGoal } from "@/domain/user-profile";
import {
  maxCredentialEntries,
  maxCredentialLength,
  userGoalOptions,
} from "@/domain/user-profile";

const usernamePattern = /^[a-z0-9][a-z0-9-]{2,31}$/;
const userGoalSet = new Set<UserGoal>(userGoalOptions);

// Validators return a dictionary key ("" when valid) so messages render in the
// caller's locale. Resolve with formatValidationMessage(key, t) — translate()
// has no interpolation, so the {max} placeholder is substituted there.

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

export function validateUsername(value: string) {
  const normalized = normalizeUsername(value);

  if (!normalized) {
    return "profileValidation.usernameRequired";
  }

  if (!usernamePattern.test(normalized)) {
    return "profileValidation.usernameInvalid";
  }

  return "";
}

/**
 * Best-effort handle from what signup already knows — the display name, then
 * the e-mail's local part — shaped to pass validateUsername, or null: the
 * username is optional and the member can pick one later. Spaces, underscores,
 * dots, emoji and anything else outside the handle alphabet collapse into one
 * hyphen; accents are folded rather than dropped ("José" → "jose", not "jos").
 * Lives next to the pattern on purpose: the derivation used to sit in the
 * signup form on top of normalizeUsername, which only lowercases and strips the
 * "@", so every compound name produced "first last" — a handle the validator
 * itself refuses.
 */
export function deriveUsername(displayName: string, email: string): string | null {
  return usernameSlug(displayName) ?? usernameSlug(email.split("@")[0] ?? "");
}

function usernameSlug(source: string): string | null {
  const slug = source
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");

  return usernamePattern.test(slug) ? slug : null;
}

export function validateDisplayName(value: string) {
  const trimmed = value.trim();

  if (trimmed.length < 2) {
    return "profileValidation.displayNameRequired";
  }

  if (trimmed.length > 120) {
    return "profileValidation.displayNameTooLong";
  }

  return "";
}

export function validateBio(value: string) {
  if (value.trim().length > 280) {
    return "profileValidation.bioTooLong";
  }

  return "";
}

export function normalizeGoals(values: string[]): UserGoal[] {
  return values.filter((value): value is UserGoal => userGoalSet.has(value as UserGoal));
}

export function normalizeCredentials(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, maxCredentialEntries);
}

export function validateCredentials(values: string[]): string {
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (normalized.length > maxCredentialEntries) {
    return "profileValidation.credentialsTooMany";
  }

  if (normalized.some((value) => value.length > maxCredentialLength)) {
    return "profileValidation.credentialsTooLong";
  }

  return "";
}

/** Resolve a validator's key to a localized message ("" stays ""). */
export function formatValidationMessage(
  key: string,
  t: (key: string) => string,
): string {
  if (!key) {
    return "";
  }

  const max =
    key === "profileValidation.credentialsTooLong"
      ? maxCredentialLength
      : maxCredentialEntries;

  return t(key).replace("{max}", String(max));
}
