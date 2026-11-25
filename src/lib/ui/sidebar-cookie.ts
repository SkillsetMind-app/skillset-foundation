// Outside "use client" on purpose: the root layout (server) reads the cookie with
// these two pieces, and the client hook writes it under the same name.

export const SIDEBAR_COOKIE = "skillset_sidebar";

/** null = the person never chose: the screen width decides. */
export type SidebarPref = "collapsed" | "expanded" | null;

export function parseSidebarPref(value: string | undefined): SidebarPref {
  return value === "collapsed" || value === "expanded" ? value : null;
}
