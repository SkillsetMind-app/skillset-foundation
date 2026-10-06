// First touch of a visitor — utm_* from the landing URL and the site that sent
// them — kept only to ride along with the signup the person submits, as user
// metadata. Nothing leaves the browser before that.
//
// POR QUE ISTO EXISTE
//
// Nenhum cadastro dizia de onde a pessoa veio: anuncio, newsletter, Instagram.
// Sem isso nao ha como saber qual canal traz conta, so qual traz visita.
//
// Consent: the banner promises non-essential storage can be refused, so the
// touch lives in memory (enough for ad -> landing -> signup, which navigates
// inside the app) and is written to sessionStorage only after "Accept all".
// "Reject" means none of it: nothing is captured, anything already held is
// wiped, and nothing is handed to the signup.

import {
  getStoredCookieConsent,
  subscribeCookieConsent,
} from "@/lib/consent/cookie-consent";

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

// User metadata travels inside the session token; a value pasted into a URL
// must not be able to bloat it.
const MAX_LENGTH = 100;
const STORAGE_KEY = "skillset.first-touch.v1";

export type FirstTouch = Partial<
  Record<(typeof UTM_KEYS)[number] | "referrer", string>
>;

let memoryTouch: FirstTouch | null = null;

export function parseFirstTouch(
  search: string,
  referrer: string,
  origin: string,
): FirstTouch {
  const params = new URLSearchParams(search);
  const touch: FirstTouch = {};

  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim().slice(0, MAX_LENGTH);
    if (value) {
      touch[key] = value;
    }
  }

  // Only the referrer's origin: its path and query can carry personal data,
  // and our own pages are not a source.
  try {
    const from = new URL(referrer).origin;
    if (from !== "null" && from !== origin) {
      touch.referrer = from.slice(0, MAX_LENGTH);
    }
  } catch {
    // Empty or not a URL: a direct visit.
  }

  return touch;
}

function isRejected(): boolean {
  return getStoredCookieConsent() === "rejected";
}

function forgetFirstTouch(): void {
  memoryTouch = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was written there.
  }
}

// Storage is the visitor's to edit: read back only the keys this module writes.
function pickKnownKeys(stored: Record<string, unknown>): FirstTouch | null {
  const touch: FirstTouch = {};
  for (const key of [...UTM_KEYS, "referrer"] as const) {
    const value = stored[key];
    if (typeof value === "string" && value) {
      touch[key] = value.slice(0, MAX_LENGTH);
    }
  }
  return Object.keys(touch).length > 0 ? touch : null;
}

/** The touch to send with a signup, or null — always null after "Reject". */
export function getFirstTouch(): FirstTouch | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (isRejected()) {
    forgetFirstTouch();
    return null;
  }
  if (memoryTouch) {
    return memoryTouch;
  }
  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Record<string, unknown> | null;
    memoryTouch = stored ? pickKnownKeys(stored) : null;
  } catch {
    memoryTouch = null;
  }
  return memoryTouch;
}

let watchingConsent = false;

/** Call on every full page load; only the first non-empty touch is kept. */
export function captureFirstTouch(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (!watchingConsent) {
    watchingConsent = true;
    // A later "Reject" (or the same choice in another tab) wipes what is held.
    // ponytail: never unsubscribed — one listener for the life of the page.
    subscribeCookieConsent(() => {
      if (isRejected()) {
        forgetFirstTouch();
      }
    });
  }
  if (isRejected() || getFirstTouch()) {
    return;
  }

  const touch = parseFirstTouch(
    window.location.search,
    document.referrer,
    window.location.origin,
  );
  if (Object.keys(touch).length === 0) {
    return;
  }

  memoryTouch = touch;
  if (getStoredCookieConsent() === "accepted") {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(touch));
    } catch {
      // Storage blocked: memory still covers this visit.
    }
  }
}
