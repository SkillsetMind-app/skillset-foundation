// Rejects passwords found in the HaveIBeenPwned "Pwned Passwords" breach corpus —
// the same protection Supabase gates behind its Pro plan, reimplemented on the
// free tier with the public k-anonymity API (no key required).
//
// Privacy: the password never leaves the browser. We hash it with SHA-1 locally
// and send only the first 5 hex chars of that hash to our own proxy; the proxy
// returns every breached suffix under that prefix and we match locally.
//
// Best-effort by design: ANY lookup failure (offline, timeout, HIBP down, our
// proxy erroring) resolves to "allow", so a third-party outage can never block a
// signup or password change. It only ever throws on a POSITIVE breach match.

const PWNED_LOOKUP_TIMEOUT_MS = 2500;

export class BreachedPasswordError extends Error {
  readonly code = "pwned_password";
  constructor() {
    super(
      "This password appeared in a known data breach. Choose a different one to keep the account secure.",
    );
    this.name = "BreachedPasswordError";
  }
}

async function sha1HexUpper(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

// The range endpoint returns lines of "SUFFIX:count" (uppercase). With padding
// enabled, decoy lines carry count 0 — a real breach match always has count > 0,
// so requiring count > 0 makes a padded decoy that happens to collide harmless.
export function isSuffixBreached(rangeBody: string, suffix: string): boolean {
  const target = suffix.toUpperCase();
  for (const line of rangeBody.split("\n")) {
    const [lineSuffix, countRaw] = line.split(":");
    if (!lineSuffix || lineSuffix.trim().toUpperCase() !== target) {
      continue;
    }
    const count = Number((countRaw ?? "").trim());
    return Number.isFinite(count) && count > 0;
  }
  return false;
}

async function isPasswordBreached(password: string): Promise<boolean> {
  const hash = await sha1HexUpper(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PWNED_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/auth/pwned-check?prefix=${prefix}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return false; // fail-open
    }
    const body = await response.text();
    return body ? isSuffixBreached(body, suffix) : false;
  } catch {
    return false; // fail-open: never block on a lookup failure
  } finally {
    clearTimeout(timer);
  }
}

/** Throws BreachedPasswordError iff the password is confirmed in a breach corpus. */
export async function assertPasswordNotBreached(
  password: string,
): Promise<void> {
  if (await isPasswordBreached(password)) {
    throw new BreachedPasswordError();
  }
}
