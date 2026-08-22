/**
 * Custom domains — the teacher points their own hostname at their storefront.
 *
 * This module is the trust boundary. Everything a teacher types goes through
 * `parseCustomDomain` before it reaches the Vercel API, the database, or the
 * proxy's host lookup, and the rules below are deliberately strict: a hostname
 * accepted here is later attached to OUR Vercel project, so a bad one is not a
 * bad row — it is a domain we are serving on someone else's behalf.
 *
 * Three refusals carry real weight and none of them are cosmetic:
 *
 * 1. NON-ASCII IS REFUSED, not punycode-converted. `аpple.com` with a Cyrillic
 *    "а" renders identically to `apple.com` in most fonts. Accepting it would
 *    let a teacher stand up a homoglyph of a real brand on infrastructure that
 *    answers with a valid SkillsetMind certificate. A teacher with a genuine
 *    IDN can enter the `xn--` form themselves, which is visible and checkable.
 *
 * 2. OUR OWN HOSTNAMES ARE REFUSED. Adding `skillsetmind.com` to the project as
 *    a "custom domain" would let one teacher's row claim the apex and take over
 *    host resolution for the whole platform. Same for the `*.vercel.app`
 *    deployment domains.
 *
 * 3. NO SCHEME, NO PATH, NO PORT, NO CREDENTIALS. People paste
 *    `https://mysite.com/` out of the address bar, so we strip a leading scheme
 *    and a trailing slash as a convenience — but anything still left over after
 *    that (a path, a query, a port, an `@`) means the input was not a hostname
 *    and we refuse rather than guess which part they meant.
 *
 * The status machine mirrors what Vercel actually reports, not what we wish it
 * reported. `pending_dns` and `pending_verification` are different problems with
 * different fixes for the teacher — one is "your DNS is not pointing here yet",
 * the other is "prove you own this by adding a TXT record" — and collapsing them
 * into one "pending" would leave the teacher staring at instructions that do not
 * match their situation.
 */

/** Longest legal hostname, per RFC 1035. */
const MAX_HOSTNAME_LENGTH = 253;
/** Longest legal DNS label, per RFC 1035. */
const MAX_LABEL_LENGTH = 63;

/**
 * Hostnames the platform serves itself. A teacher may never claim one of these,
 * because doing so would hijack host resolution for everyone else.
 *
 * Matching is on the apex AND any subdomain of it: `foo.skillsetmind.com` is as
 * dangerous as the apex, since the proxy resolves by host and would happily
 * serve a teacher's storefront from what looks like an official subdomain.
 */
const RESERVED_APEXES = [
  "skillsetmind.com",
  "skillsetmind.app",
  "vercel.app",
  "vercel.sh",
  "localhost",
] as const;

export type CustomDomainStatus =
  /** Added to the Vercel project; the teacher's DNS does not point here yet. */
  | "pending_dns"
  /** Vercel wants a TXT record to prove ownership (domain already in use there). */
  | "pending_verification"
  /** Verified, certificate issued, serving. */
  | "active"
  /** Vercel rejected it, or it was removed upstream. Carries a reason. */
  | "error";

export type CustomDomain = {
  id: string;
  /** Owner. One teacher may hold several, up to their plan's quota. */
  ownerUid: string;
  /** Normalised hostname — lowercase, no scheme, no trailing dot. */
  hostname: string;
  status: CustomDomainStatus;
  /** TXT record name/value Vercel asked for, when status is pending_verification. */
  verificationRecord: { name: string; value: string } | null;
  /** Human-readable reason, only when status is error. */
  errorReason: string | null;
  createdAt: string;
  verifiedAt: string | null;
};

export type ParsedDomain =
  | { ok: true; hostname: string }
  | { ok: false; reason: DomainRejection };

export type DomainRejection =
  | "empty"
  | "too_long"
  | "has_scheme_or_path"
  | "non_ascii"
  | "malformed"
  | "single_label"
  | "reserved";

/**
 * Messages are written for the teacher, not for a log: each one says what is
 * wrong AND what to type instead, because the most common cause of every single
 * one of these is a paste out of the browser address bar.
 */
export const domainRejectionMessage: Record<DomainRejection, string> = {
  empty: "Enter a domain, for example yourname.com",
  too_long: "That domain is too long to be valid.",
  has_scheme_or_path:
    "Enter only the domain — yourname.com, not a full web address with a path.",
  non_ascii:
    "Enter the domain in its ASCII form. If it uses accents or non-Latin characters, your registrar shows a version starting with xn--.",
  malformed: "That does not look like a domain. Example: yourname.com",
  single_label: "Include the ending, for example yourname.com rather than yourname",
  reserved: "That domain belongs to the platform and cannot be claimed.",
};

/**
 * A DNS label: letters, digits and hyphens, never starting or ending with a
 * hyphen. The underscore is legal in some record types but never in a hostname
 * that will hold a certificate, so it is refused here.
 */
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The last label must be a real TLD-shaped string: letters only, at least two.
 * This is what stops `192.168.0.1` and `mysite.1` from being accepted as
 * hostnames, without needing to carry a TLD list that would go stale.
 */
const TLD = /^[a-z]{2,}$/;

export function parseCustomDomain(input: string): ParsedDomain {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }

  // Convenience only: people paste out of the address bar. We strip a leading
  // scheme and ONE trailing slash, then require that nothing else structural is
  // left. Anything beyond that and we refuse instead of guessing.
  let candidate = trimmed.replace(/^https?:\/\//i, "").replace(/\/$/, "");

  // A trailing dot is the fully-qualified form and is legal in DNS, but Vercel
  // and our host header comparison both use the bare form.
  candidate = candidate.replace(/\.$/, "");

  if (/[/?#@\s]/.test(candidate) || candidate.includes(":")) {
    return { ok: false, reason: "has_scheme_or_path" };
  }

  // Before lowercasing: refuse anything outside printable ASCII. See the
  // homoglyph note at the top of this file — this check is the reason it exists.
  if (/[^\x20-\x7E]/.test(candidate)) {
    return { ok: false, reason: "non_ascii" };
  }

  const hostname = candidate.toLowerCase();

  if (hostname.length > MAX_HOSTNAME_LENGTH) {
    return { ok: false, reason: "too_long" };
  }

  const labels = hostname.split(".");
  if (labels.length < 2) {
    return { ok: false, reason: "single_label" };
  }

  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
      return { ok: false, reason: "malformed" };
    }
    if (!LABEL.test(label)) {
      return { ok: false, reason: "malformed" };
    }
  }

  if (!TLD.test(labels[labels.length - 1])) {
    return { ok: false, reason: "malformed" };
  }

  if (isReserved(hostname)) {
    return { ok: false, reason: "reserved" };
  }

  return { ok: true, hostname };
}

/**
 * True for our own hostnames and anything beneath them. Compared label-wise
 * rather than with `endsWith`, because `endsWith` would also match
 * `notskillsetmind.com` — a domain someone else may legitimately own.
 */
export function isReserved(hostname: string): boolean {
  return RESERVED_APEXES.some(
    (apex) => hostname === apex || hostname.endsWith(`.${apex}`),
  );
}

/** Does this status mean the domain is serving traffic right now? */
export function isServing(status: CustomDomainStatus): boolean {
  return status === "active";
}

/**
 * Only `active` domains take part in host resolution. A pending domain that
 * already has DNS pointing at us must NOT resolve to its owner's storefront:
 * ownership is unproven until Vercel says so, and serving it early is exactly
 * the window an attacker would use to park a name on our certificate.
 */
export function resolvableHostnames(
  domains: ReadonlyArray<Pick<CustomDomain, "hostname" | "status">>,
): ReadonlyArray<string> {
  return domains.filter((d) => isServing(d.status)).map((d) => d.hostname);
}

/**
 * What the teacher has to do next, in their words. Drives the instruction panel
 * in the storefront settings; returning null means there is nothing to do.
 */
export function nextActionFor(domain: Pick<CustomDomain, "status">): string | null {
  switch (domain.status) {
    case "pending_dns":
      return "Add the DNS records below at your registrar. DNS changes can take up to 48 hours to reach everyone.";
    case "pending_verification":
      return "Add the TXT record below to prove you own this domain, then check again.";
    case "error":
      return "Something went wrong with this domain. Remove it and add it again, or contact support.";
    case "active":
      return null;
  }
}

/**
 * The apex needs an A record; anything deeper needs a CNAME. Getting this
 * backwards is the single most common reason a custom domain never goes live,
 * so the instruction panel derives it rather than showing both and hoping.
 *
 * The values are Vercel's documented targets for a project domain.
 */
export function dnsInstructionFor(hostname: string): {
  type: "A" | "CNAME";
  name: string;
  value: string;
} {
  const isApex = hostname.split(".").length === 2;
  return isApex
    ? { type: "A", name: "@", value: "216.198.79.1" }
    : {
        type: "CNAME",
        name: hostname.split(".")[0],
        value: "cname.vercel-dns.com",
      };
}
