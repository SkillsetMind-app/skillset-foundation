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

export function getAuthPathQuery(intent: AuthPathIntent | null): string {
  return intent ? `?path=${intent}` : "";
}

/**
 * Validates a post-login destination so deep links survive the sign-in wall
 * without opening a redirect hole. Only same-origin absolute paths pass:
 * anything with a scheme/host ("https://evil", "//evil", "/\evil") or a
 * route that would loop the auth flow is rejected.
 */
export function getSafeReturnTo(
  searchParams: URLSearchParams,
): string | null {
  const raw = searchParams.get("returnTo");

  if (!raw || !raw.startsWith("/")) {
    return null;
  }

  // "//host" and "/\host" are protocol-relative escapes browsers honor.
  if (raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }

  const authRoutes = ["/login", "/signup", "/auth", "/loading", "/welcome", "/logout"];

  if (authRoutes.some((route) => raw === route || raw.startsWith(`${route}?`) || raw.startsWith(`${route}/`))) {
    return null;
  }

  return raw;
}

export function getLoadingRoute(
  next: "route" | "welcome",
  intent: AuthPathIntent | null = null,
): string {
  const searchParams = new URLSearchParams({ next });

  if (intent) {
    searchParams.set("path", intent);
  }

  return `/loading?${searchParams.toString()}`;
}

export function getPostAuthRoute(
  profile: UserProfile | null,
  intent: AuthPathIntent | null = null,
): string {
  if (!profile?.onboardingCompleted) {
    return `/welcome${getAuthPathQuery(intent)}`;
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
