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

/**
 * The short entry hosts and the area each one opens. One table serves
 * both directions: the proxy asks "which area does this host open?" and the
 * public links ask "which host publishes this area?". Nothing else in the
 * codebase spells these hostnames out.
 */
const ENTRIES = {
  app: { host: "app.skillsetmind.com", path: "/teach" },
  consumer: { host: "consumer.skillsetmind.com", path: "/learn" },
  pay: { host: "pay.skillsetmind.com", path: "/courses" },
  sso: { host: "sso.skillsetmind.com", path: "/login" },
} as const;

export type EntryKind = keyof typeof ENTRIES;

// Entry links use the existing session host; they never start a second login.
const PLATFORM_ENTRIES = new Map<string, string>(
  Object.values(ENTRIES).map(({ host, path }): [string, string] => [host, path]),
);

/**
 * Where the short hosts are known to resolve. `isPlatformHost` also accepts
 * previews and localhost, which is right for serving but wrong for publishing:
 * an absolute `pay.skillsetmind.com` link pasted from a Vercel preview would
 * pull the visitor out of the preview and into production.
 */
export function isProductionHost(hostname: string | null | undefined): boolean {
  return hostname === "skillsetmind.com" || hostname === "www.skillsetmind.com";
}

/**
 * Public link for a short entry host, built from the table above so no
 * component carries the hostname as a loose string.
 *
 * On a production host it is `https://<entry>.skillsetmind.com<path><search>`.
 * Anywhere else — a preview, localhost, or a render that does not know its host
 * yet (`hostname` null on the server) — it stays relative, so the link keeps
 * the visitor on the origin they are already on. Forgetting the hostname
 * therefore fails toward "stay here", never toward a wrong absolute host.
 *
 * An empty path mirrors the proxy's root rule: the short host itself in
 * production, the area it opens elsewhere.
 */
export function entryUrl(
  kind: EntryKind,
  path = "",
  search = "",
  hostname: string | null | undefined = null,
): string {
  const entry = ENTRIES[kind];
  if (isProductionHost(hostname)) return `https://${entry.host}${path}${search}`;
  return `${path === "" || path === "/" ? entry.path : path}${search}`;
}

export type HostRouteDecision =
  /** Not a custom domain, or nothing to do — hand the request on untouched. */
  | { kind: "pass" }
  /** Serve this internal path instead, without changing the visible URL. */
  | { kind: "rewrite"; path: string }
  /** Send the visitor to the platform's own hostname. */
  | { kind: "redirect"; url: string; status?: 307 | 308 }
  /** Entry aliases do not forward request bodies to another origin. */
  | { kind: "method-not-allowed" };

/**
 * Paths left untouched on platform and teacher hosts. Next internals and the API
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
  /** Hostname normalized by normaliseHostHeader before classification/lookup. */
  hostname: string;
  pathname: string;
  search: string;
  method?: string;
  /** uid resolved from public_domains, or null when this host is not ours. */
  resolvedUid: string | null;
}): HostRouteDecision {
  const { hostname, pathname, search, resolvedUid, method = "GET" } = input;

  const entryPath = PLATFORM_ENTRIES.get(hostname);
  if (entryPath) {
    if (method !== "GET" && method !== "HEAD") return { kind: "method-not-allowed" };
    return {
      kind: "redirect",
      status: 307,
      url: `${PLATFORM_ORIGIN}${pathname === "/" || pathname === "" ? entryPath : pathname}${search}`,
    };
  }

  // Outside the entry aliases, assets and API are never touched: rewriting breaks Next, and
  // the API is already origin-agnostic. It comes before everything because an unresolved
  // domain still needs to serve its own assets while the visitor is
  // sent away.
  if (NEVER_TOUCH.some((prefix) => pathname.startsWith(prefix))) {
    return { kind: "pass" };
  }

  // The platform host continues as usual.
  if (isPlatformHost(hostname)) {
    return { kind: "pass" };
  }

  // Got here: the host is NOT ours and does not resolve to any teacher.
  //
  // The old comment here said "it may be the platform's own host, a
  // preview URL or localhost: in any case the request is already where
  // it should be" and returned `pass`. That premise became false when the
  // custom domain feature came in: isPlatformHost already went through the guard ABOVE,
  // so what is left here is precisely the dangerous case:
  // a hostname attached to the Vercel project but NOT yet verified (the route
  // attaches before proving ownership), or one whose row vanished when the teacher
  // detached it. In both, serving `pass` published real /login and /signup under a
  // name the platform does not control, with a valid certificate: exactly the
  // credential harvester that this file's header exists to prevent.
  //
  // Fail CLOSED. The visitor goes to the platform; no identity is
  // rendered under a third-party host.
  if (!resolvedUid) {
    return { kind: "redirect", url: `${PLATFORM_ORIGIN}${pathname}${search}` };
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
 * Strips the port and one DNS root dot, then lowercases for host comparison.
 * `Example.COM.:3000` and `example.com` must select the same route before any
 * custom-domain lookup. Bracketed IPv6 follows its existing branch below.
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
  const hostname = colon === -1 ? trimmed : trimmed.slice(0, colon);
  return hostname.replace(/\.$/, "");
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
