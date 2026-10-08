import { currentPrivacyVersion, currentTermsVersion } from "@/lib/legal/versions";

// The terms ticked at signup are recorded without asking again only when the
// confirmation comes back to THIS browser. Anyone else, someone confirming on
// another device or the owner of an email that a stranger signed up with,
// gets the first-acceptance prompt instead: the tick was not theirs here.
export const SIGNUP_TERMS_MARK_KEY = "skillset.signupTerms";
const MARK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function markSignupTerms(uid: string): void {
  try {
    window.localStorage.setItem(SIGNUP_TERMS_MARK_KEY, JSON.stringify({
      uid,
      terms: currentTermsVersion,
      privacy: currentPrivacyVersion,
      expiresAt: Date.now() + MARK_TTL_MS,
    }));
  } catch {
    // No storage (private window): the first signed-in page asks instead.
  }
}

/** This browser signed up this account, on the current versions, not long ago. */
export function hasSignupTermsMark(uid: string): boolean {
  try {
    const mark = JSON.parse(window.localStorage.getItem(SIGNUP_TERMS_MARK_KEY) ?? "null");
    return mark?.uid === uid
      && mark.terms === currentTermsVersion
      && mark.privacy === currentPrivacyVersion
      && typeof mark.expiresAt === "number"
      && mark.expiresAt > Date.now();
  } catch {
    return false;
  }
}

export function clearSignupTermsMark(): void {
  try {
    window.localStorage.removeItem(SIGNUP_TERMS_MARK_KEY);
  } catch {
    // Nothing to clear.
  }
}
