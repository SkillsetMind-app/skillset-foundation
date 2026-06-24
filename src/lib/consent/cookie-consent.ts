// Client-side cookie/consent preference store.
//
// PostHog initialization uses prior-consent (opt-in): it captures NOTHING until
// the visitor explicitly accepts (see lib/posthog/client.ts — the opt_out
// default is keyed off `=== "accepted"`). An explicit "reject" also persists,
// and either decision is stored in localStorage so the banner shows once and is
// respected on return visits. `reopenCookieConsent()` clears the decision so a
// visitor can review, change, or withdraw consent at any time (GDPR Art. 7(3) —
// withdrawal as easy as granting; CCPA "Your Privacy Choices").
//
// `hasAnalyticsConsent` keeps a legacy opt-out reading (undecided = allowed) and
// is NOT the runtime gate for capture — PostHog's own opt-in/out state is.
//
// The store is exposed as a subscribable external store so React components can
// read it with useSyncExternalStore (SSR-safe, no setState-in-effect).
//
// Bump the version suffix in STORAGE_KEY whenever the cookie categories change
// in a way that requires re-consent.

export type CookieConsentDecision = "accepted" | "rejected";

const STORAGE_KEY = "skillset.cookie-consent.v1";

// In-memory fallback used only when localStorage access throws (private mode,
// hardened browsers). Lets a decision made this session keep the banner
// dismissed even when nothing can be persisted to disk.
let blockedStorageDecision: CookieConsentDecision | null = null;

type ConsentListener = () => void;
const listeners = new Set<ConsentListener>();

function emitConsentChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getStoredCookieConsent(): CookieConsentDecision | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "accepted" || value === "rejected" ? value : null;
  } catch {
    // Storage blocked (private mode, hardened browser) — fall back to the
    // session-only decision so a choice made this session is still honored.
    return blockedStorageDecision;
  }
}

export function setStoredCookieConsent(decision: CookieConsentDecision): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, decision);
  } catch {
    // Storage blocked — keep the decision in memory so the banner still
    // dismisses this session; it will reappear next visit, which is acceptable.
    blockedStorageDecision = decision;
  }

  emitConsentChange();
}

/**
 * Reopen the consent choice: clears the stored decision so the banner shows
 * again, letting a visitor change or withdraw consent at any time (GDPR Art.
 * 7(3); CCPA "Your Privacy Choices"). Triggered from the footer control.
 */
export function reopenCookieConsent(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked — clearing the in-memory decision below still re-shows
    // the banner for this session.
  }
  blockedStorageDecision = null;
  emitConsentChange();
}

export function hasAnalyticsConsent(): boolean {
  // Opt-out model: only an explicit "rejected" disables analytics. Undecided
  // and "accepted" both allow capture.
  return getStoredCookieConsent() !== "rejected";
}

export function shouldShowCookieBanner(): boolean {
  // The banner is shown only until the visitor makes an explicit choice.
  return getStoredCookieConsent() === null;
}

export function subscribeCookieConsent(listener: ConsentListener): () => void {
  listeners.add(listener);

  // Keep multiple tabs in sync: a decision made in another tab should dismiss
  // the banner here as well.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}
