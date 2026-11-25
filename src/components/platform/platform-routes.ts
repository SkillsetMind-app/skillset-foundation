// The PlatformShell page rules, in one place. The real shell
// (platform-shell.tsx) and the login guard's wait screen (protected-surface.tsx)
// both read from here: the wait column and the page column cannot diverge. Without
// "use client" on purpose: pure functions, they serve both server and client.

function under(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The logged-in areas whose pages open inside the PlatformShell. */
export const PLATFORM_SHELL_AREAS = ["/teach", "/learn", "/account", "/ops", "/support"] as const;

/**
 * Inside those areas, the screens with another shell: the classroom and the members
 * area (MemberAreaShell), the course preview in the builder (MemberAreaShell)
 * and the printable certificate (no shell). src/app/espera-pela-casca.test.ts
 * checks, page by page, that only these stay outside.
 */
export const OTHER_SHELL_PREFIXES = ["/learn/courses/", "/learn/areas/", "/learn/credentials/", "/teach/builder/"] as const;

/** Does the page open inside the PlatformShell? Outside the list, no (when in doubt, no). */
export function opensInPlatformShell(pathname: string) {
  return PLATFORM_SHELL_AREAS.some((area) => under(pathname, area))
    && !OTHER_SHELL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Studio, account and learner lists: a column of at most 1280px, centered.
 * On a 1920px monitor the sales list had the title at the left edge and the
 * value 1500px later.
 */
export function isFramedPlatformRoute(pathname: string) {
  const teachRoute = under(pathname, "/teach");
  // The builder uses the full width, decided by the address too: by the
  // loaded editor's class, the skeleton (and the error, and the screen with no course)
  // came out in the 1280px column and the page then jumped to full width.
  const builderRoute = under(pathname, "/teach/builder");
  // The same column in the account (Earnings opens from the teacher bar) and in the learner
  // lists. Outside it, on purpose: the classroom (full width by
  // design), the members area and the plan payment screens (checkout, return from
  // checkout and the plan choice), which stay as they were.
  const learnListRoute = under(pathname, "/learn")
    && !pathname.startsWith("/learn/courses/") && !pathname.startsWith("/learn/areas/");
  const checkoutRoute = pathname.startsWith("/account/billing/upgrade")
    || pathname.startsWith("/account/billing/return")
    || pathname.startsWith("/account/plans");
  const accountRoute = under(pathname, "/account") && !checkoutRoute;
  return (teachRoute && !builderRoute) || accountRoute || learnListRoute;
}
