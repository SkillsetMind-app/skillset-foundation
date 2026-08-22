/**
 * What a request arriving on a custom domain should become.
 *
 * Kept pure and separate from the proxy so the decision can be tested without a
 * request, a database or a running server. `src/proxy.ts` does the lookup and
 * then asks this module what to do with the answer.
 *
 * THE RULE THAT MATTERS MOST: a custom domain serves the teacher's public
 * surface and nothing else. Everything that involves an identity — sign-in,
 * sign-up, the studio, the account area — redirects back to the platform's own
 * hostname instead of being served under the teacher's.
 *
 * That is not tidiness, it is the security boundary of this whole feature. The
 * teacher controls the DNS for their domain, and one day some of them will let
 * it lapse. Whoever registers it next inherits a name that our certificate
 * answers for. If we had ever served the login form there, that person now has
 * a pixel-perfect credential harvester on infrastructure the victim has been
 * taught to trust. Refusing to render an auth surface on a hostname we do not
 * control removes the prize entirely.
 *
 * The second reason is duller and still real: cookies are per-origin, so a
 * session started on the teacher's domain is a different session from the one
 * on ours. Serving auth on both produces a user who is somehow logged in and
 * logged out at the same time.
 */

/** The platform's own hostname, used as the redirect target. */
export const PLATFORM_ORIGIN = "https://skillsetmind.com";

export type HostRouteDecision =
  /** Not a custom domain, or nothing to do — hand the request on untouched. */
  | { kind: "pass" }
  /** Serve this internal path instead, without changing the visible URL. */
  | { kind: "rewrite"; path: string }
  /** Send the visitor to the platform's own hostname. */
  | { kind: "redirect"; url: string };

/**
 * Paths that must never be touched, on any host. Next internals and the API
 * both break in confusing ways if rewritten, and the API is already
 * origin-agnostic.
 */
const NEVER_TOUCH = [
  "/_next/",
  "/api/",
  "/__nextjs",
  "/favicon",
  "/icon",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
];

/**
 * The public surface a teacher's domain is allowed to serve. Everything outside
 * this list goes back to the platform — see the security note at the top.
 *
 * `/courses/` is here because the course sales page is the other thing a teacher
 * points a domain at, and it is public by definition: it exists to be found by
 * someone who is not logged in.
 */
const TEACHER_PUBLIC_PREFIXES = ["/courses/", "/instructors/"];

export function decideHostRoute(input: {
  /** Hostname from the Host header, already lowercased and port-stripped. */
  hostname: string;
  pathname: string;
  search: string;
  /** uid resolved from public_domains, or null when this host is not ours. */
  resolvedUid: string | null;
}): HostRouteDecision {
  const { pathname, search, resolvedUid } = input;

  // Unknown host. Could be the platform's own hostname, a preview URL, or
  // localhost — in every case the request is already where it belongs.
  if (!resolvedUid) {
    return { kind: "pass" };
  }

  if (NEVER_TOUCH.some((prefix) => pathname.startsWith(prefix))) {
    return { kind: "pass" };
  }

  // The root of a teacher's domain is their storefront. This is the whole point
  // of the feature.
  if (pathname === "/" || pathname === "") {
    return { kind: "rewrite", path: `/instructors/${resolvedUid}${search}` };
  }

  if (TEACHER_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return { kind: "pass" };
  }

  // Everything else — /login, /signup, /account, /teach, /ops, and anything
  // added later that nobody remembered to consider here. Defaulting to redirect
  // rather than pass is deliberate: a new authenticated route added a year from
  // now is protected by this line without its author having to know this file
  // exists.
  return { kind: "redirect", url: `${PLATFORM_ORIGIN}${pathname}${search}` };
}

/**
 * Strips the port and lowercases, which is what a Host header needs before it
 * can be compared with a stored hostname. `example.com:3000` in development and
 * `Example.COM` from a hand-written client both have to match `example.com`.
 *
 * IPv6 literals arrive bracketed (`[::1]:3000`), so the port split has to happen
 * after the bracket, not at the first colon.
 */
export function normaliseHostHeader(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    return close === -1 ? trimmed : trimmed.slice(1, close);
  }

  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/**
 * Hostnames the platform answers on itself. Checked before any database lookup
 * so that ordinary traffic — which is all of it, for now — never pays for a
 * query, and so that a stray row in `public_domains` claiming our own apex could
 * not hijack the platform even if one ever appeared.
 */
export function isPlatformHost(hostname: string): boolean {
  return (
    hostname === "skillsetmind.com" ||
    hostname.endsWith(".skillsetmind.com") ||
    hostname.endsWith(".vercel.app") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}
