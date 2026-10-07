import type { SkillsetUser } from "@/domain/auth";
import type { UserProfile } from "@/domain/user-profile";
import { hasPermission } from "@/lib/permissions";

export type AuthPathIntent = "student" | "teacher";

/**
 * Role → primary workspace (portal) entry. Used by the marketing header, the
 * home hero, and the account menu so a signed-in visitor always has one clear
 * path back to their dashboard. Mirrors getPostAuthRoute's role branch minus
 * the onboarding/intent steps that only apply immediately after authentication.
 *
 * The /ops branch asks the permission, not a role list: /ops itself gates on
 * platform.accessAdmin, and a hardcoded list drifted from it in both
 * directions — "ops", the role named after the workspace, was never sent
 * there, while "support" was sent there without the permission to open it.
 */
export function getPrimaryWorkspaceHref(
  user: Pick<SkillsetUser, "roles">,
): string {
  if (hasPermission(user, "platform.accessAdmin")) {
    return "/ops";
  }

  if (user.roles.includes("teacher")) {
    return "/teach";
  }

  return "/learn";
}

/**
 * Keeps application chrome inside the workspace the user is currently using.
 * Explicit workspace routes win; shared surfaces fall back to the user's
 * primary role instead of sending them to the public site or a generic hub.
 */
export function getWorkspaceHomeHref(
  pathname: string,
  user: Pick<SkillsetUser, "roles"> | null | undefined,
): string {
  if (pathname.startsWith("/teach") || pathname.startsWith("/account/payments")) {
    return "/teach";
  }

  if (pathname.startsWith("/ops")) {
    return "/ops";
  }

  if (pathname.startsWith("/learn")) {
    return "/learn";
  }

  return user ? getPrimaryWorkspaceHref(user) : "/platform";
}

export type WorkspaceSide = "student" | "teacher" | "ops";

/**
 * Which side of the platform a page belongs to — the top bar names it and
 * offers the way to the other side, and the Help menu picks its choices by
 * it. Same rule as the logo's home link, so the two never disagree.
 */
export function getWorkspaceSide(
  pathname: string,
  user: Pick<SkillsetUser, "roles"> | null | undefined,
): WorkspaceSide {
  const home = getWorkspaceHomeHref(pathname, user);
  return home === "/teach" ? "teacher" : home === "/ops" ? "ops" : "student";
}

export function parseAuthPathIntent(value: string | null | undefined): AuthPathIntent | null {
  if (value === "student" || value === "teacher") {
    return value;
  }

  return null;
}

export function getAuthPathIntentFromSearchParams(
  searchParams: URLSearchParams,
): AuthPathIntent | null {
  return (
    parseAuthPathIntent(searchParams.get("path")) ??
    parseAuthPathIntent(searchParams.get("role"))
  );
}

const RETURN_TO_BASE = "https://base.invalid";
const AUTH_ROUTES = ["/login", "/signup", "/auth", "/loading", "/welcome", "/logout"];

/**
 * Validates a post-login destination so deep links survive the sign-in wall
 * without opening a redirect hole. Only same-origin absolute paths pass:
 * anything with a scheme/host ("https://evil", "//evil", "/\evil") or a
 * route that would loop the auth flow is rejected.
 *
 * Judged the way a browser will read it: resolved by the URL parser first
 * (dot segments: "/..//evil" is "//evil") and then decoded ("/%2F%2Fevil",
 * "/%5Cevil"). What is returned is that resolved path, never the raw text.
 */
export function getSafeReturnTo(
  searchParams: URLSearchParams,
): string | null {
  const raw = searchParams.get("returnTo");

  if (!raw?.startsWith("/") || hasUnsafeChar(raw)) {
    return null;
  }

  let target: URL;
  let path: string;
  try {
    target = new URL(raw, RETURN_TO_BASE);
    path = decodeURIComponent(target.pathname);
  } catch {
    return null;
  }

  if (target.origin !== RETURN_TO_BASE || !path.startsWith("/") || path.includes("//") || hasUnsafeChar(path)) {
    return null;
  }

  if (AUTH_ROUTES.some((route) => path === route || path.startsWith(`${route}/`))) {
    return null;
  }

  return target.pathname + target.search + target.hash;
}

// URL parsing drops TAB/LF/CR and reads "\" as "/": /\n/host or /\host would
// become //host in the router.
function hasUnsafeChar(text: string): boolean {
  return [...text].some((char) => char === "\\" || char < " " || char === "\u007f");
}

export function getAuthErrorRoute(reason: string, next: string): string {
  const params = new URLSearchParams({ error: reason });
  if (next === "/" || !next.startsWith("/") || next.startsWith("//") || /[\\\t\n\r]/.test(next)) {
    return `/login?${params}`;
  }

  const destination = new URL(next, "https://auth.invalid");
  const isEntry = ["/loading", "/welcome"].includes(destination.pathname);
  if (isEntry) {
    const intent = getAuthPathIntentFromSearchParams(destination.searchParams);
    if (intent) params.set("path", intent);
  }

  const returnTo = getSafeReturnTo(isEntry
    ? destination.searchParams
    : new URLSearchParams({ returnTo: next }));
  if (returnTo) {
    const target = new URL(returnTo, destination.origin);
    const normalized = target.pathname + target.search + target.hash;
    // A failed recovery link must not send a normal login to the reset form.
    if (target.origin === destination.origin && !/^\/reset-password(?:\/|$)/.test(target.pathname)
      && getSafeReturnTo(new URLSearchParams({ returnTo: target.pathname }))) {
      params.set("returnTo", normalized);
    }
  }
  return `/login?${params}`;
}

export function getLoadingRoute(
  next: "route" | "welcome",
  intent: AuthPathIntent | null = null,
  returnTo: string | null = null,
): string {
  const searchParams = new URLSearchParams({ next });

  if (intent) {
    searchParams.set("path", intent);
  }

  // Deep link to honor once /loading confirms the account is onboarded. Google
  // sign-in has to carry it through the OAuth round trip, so it rides in the
  // URL like the intent does.
  if (returnTo) {
    searchParams.set("returnTo", returnTo);
  }

  return `/loading?${searchParams.toString()}`;
}

export function getAuthRoute(
  mode: "signin" | "signup",
  intent: AuthPathIntent | null = null,
  returnTo: string | null = null,
): string {
  const searchParams = new URLSearchParams({ mode });

  if (intent) {
    searchParams.set("path", intent);
  }

  const safeReturnTo = getSafeReturnTo(new URLSearchParams({ returnTo: returnTo ?? "" }));
  if (safeReturnTo) {
    searchParams.set("returnTo", safeReturnTo);
  }

  return `/auth?${searchParams.toString()}`;
}

/**
 * The single builder for the /welcome (onboarding) entry. It carries the deep
 * link the sign-in wall captured, because onboarding used to be where that link
 * died: someone who pressed "enroll" on a course page, created an account and
 * answered the wizard landed on /learn and never saw the course again — the sale
 * was lost between two screens. Every route into /welcome goes through here so
 * the destination cannot be dropped by one caller and kept by the next.
 */
export function getWelcomeRoute(
  intent: AuthPathIntent | null = null,
  returnTo: string | null = null,
): string {
  const searchParams = new URLSearchParams();

  if (intent) {
    searchParams.set("path", intent);
  }

  if (returnTo) {
    searchParams.set("returnTo", returnTo);
  }

  const query = searchParams.toString();

  return query ? `/welcome?${query}` : "/welcome";
}

export function getPostAuthRoute(
  profile: UserProfile | null,
  intent: AuthPathIntent | null = null,
): string {
  if (!profile?.onboardingCompleted) {
    return getWelcomeRoute(intent);
  }

  if (intent === "teacher") {
    return profile.roles.includes("teacher") ? "/teach" : "/onboarding?path=teacher";
  }

  if (intent === "student") {
    return "/learn";
  }

  if (profile.onboardingPath === "teacher" && !profile.roles.includes("teacher")) {
    return "/onboarding?path=teacher";
  }

  if (hasPermission(profile, "platform.accessAdmin")) {
    return "/ops";
  }

  if (profile.roles.includes("teacher")) {
    return "/teach";
  }

  return "/learn";
}
