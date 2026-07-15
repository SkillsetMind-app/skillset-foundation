/**
 * Returns the trimmed URL only when it is a syntactically valid absolute
 * http(s) URL; otherwise null.
 *
 * Use this to gate ANY `href` built from user/teacher-controlled input (course
 * event links, lesson external links). Firestore rules only check length, so a
 * stored value like `javascript:alert(1)` or `data:...` would otherwise reach
 * the DOM as a clickable link — a stored-XSS / open-redirect vector. Rendering
 * the link only when this returns non-null closes that hole and also avoids
 * broken links from empty/garbage values.
 */
export function getSafeExternalUrl(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);

    return url.protocol === "https:" || url.protocol === "http:"
      ? trimmed
      : null;
  } catch {
    return null;
  }
}

/**
 * Hosts we accept for course cover images / lesson media that end up rendered
 * as <img src>. Blocks arbitrary external tracker URLs (Tea-app style EXIF/
 * IP-leak and vibecoder "any URL on edit" bugs).
 *
 * Relative paths (e.g. /brand/logo-mark.png) are always allowed.
 * Absolute URLs must be https and match an allowlisted host suffix.
 */
const DEFAULT_MEDIA_HOST_SUFFIXES = [
  "supabase.co",
  "supabase.in",
  "b-cdn.net",
  "bunnycdn.com",
  "mediadelivery.net",
  "r2.dev",
  "cloudflarestorage.com",
  "stripe.com",
  "skillsetmind.com",
  "localhost",
] as const;

export function isAllowedMediaHost(
  hostname: string,
  allowedSuffixes: readonly string[] = DEFAULT_MEDIA_HOST_SUFFIXES,
): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  return allowedSuffixes.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

/**
 * Safe media URL for stored course covers / lesson images.
 * - Relative same-origin paths → accepted as-is (trimmed)
 * - https absolute on allowlisted hosts → accepted
 * - http only for localhost (dev)
 * - Everything else (javascript:, external tracker hosts, huge query abuse) → null
 *
 * Caps total length at 2048 to limit storage/DoS via long query strings.
 */
export function getSafeMediaUrl(
  value: string | null | undefined,
  opts?: { maxLength?: number; allowedHostSuffixes?: readonly string[] },
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const maxLength = opts?.maxLength ?? 2048;
  if (!trimmed || trimmed.length > maxLength) return null;

  // Same-origin relative asset
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    if (trimmed.includes("\\") || trimmed.includes("\0")) return null;
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const hostOk = isAllowedMediaHost(
      url.hostname,
      opts?.allowedHostSuffixes ?? DEFAULT_MEDIA_HOST_SUFFIXES,
    );
    if (!hostOk) return null;
    if (url.protocol === "https:") return trimmed;
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return trimmed;
    }
    return null;
  } catch {
    return null;
  }
}
