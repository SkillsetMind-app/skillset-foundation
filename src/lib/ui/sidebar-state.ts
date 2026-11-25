"use client";

import { useContext, useSyncExternalStore } from "react";

import { parseSidebarPref, SIDEBAR_COOKIE, type SidebarPref } from "@/lib/ui/sidebar-cookie";
import { SidebarPrefContext } from "@/lib/ui/sidebar-preference";

/** 768–1023px: always the rail. Open, the sidebar would leave ~465px of content and the
 *  top bar does not fit (the math is in src/app/barra-do-topo-cabe.test.ts). */
const TABLET_QUERY = "(min-width: 768px) and (width < 1024px)";
/** 1024–1179px: the rail is the default for anyone who never chose; whoever opened it stays open. */
const LAPTOP_QUERY = "(min-width: 1024px) and (width < 1180px)";

/** Where the choice lived before the cookie. */
export const LEGACY_SIDEBAR_KEY = "skillset_sidebar_state";

// The old key is not read (the cookie replaced it); it is only deleted, once per
// load, when this module reaches the browser.
if (typeof window !== "undefined") {
  try {
    window.localStorage.removeItem(LEGACY_SIDEBAR_KEY);
  } catch {
    // ponytail: storage blocked (sandboxed iframe, private mode): nothing to delete.
  }
}

// The cookie is the source of the choice. On the server (and during hydration)
// the value the logged-in area layout read applies; in the browser, the cookie
// itself — the layout does not run again on a navigation, and each page mounts
// its own PlatformShell.
const listeners = new Set<() => void>();
const cookiePattern = new RegExp(`(?:^|;\\s*)${SIDEBAR_COOKIE}=([^;]*)`);

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function readCookie(): SidebarPref {
  try {
    return parseSidebarPref(document.cookie.match(cookiePattern)?.[1]);
  } catch {
    return null;
  }
}

// Only a click on the button (or on a group, in the collapsed desktop sidebar)
// changes the sidebar. No expanding on hover: the menu jumped when the cursor
// passed nearby.
export function useSidebarState() {
  const fromServer = useContext(SidebarPrefContext);
  const pref = useSyncExternalStore(subscribe, readCookie, () => fromServer);
  const isTablet = useMediaQuery(TABLET_QUERY);
  const isLaptop = useMediaQuery(LAPTOP_QUERY);
  const isCollapsed = isTablet || (pref ? pref === "collapsed" : isLaptop);

  function toggle() {
    try {
      document.cookie = `${SIDEBAR_COOKIE}=${isCollapsed ? "expanded" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // ponytail: a page without cookies (sandboxed iframe) stays on the screen default.
    }
    listeners.forEach((onChange) => onChange());
  }

  return {
    /** In the rail range, a collapsed group opens the drawer instead of the sidebar. */
    isRail: isTablet || isLaptop,
    isCollapsed,
    /** No saved choice: CSS decides the width from the screen already on the 1st frame. */
    isAuto: pref === null,
    toggle,
  };
}

/**
 * `useSyncExternalStore` instead of effect + state: the server snapshot is
 * `false` (the server does not know the window size), so there is no hydration
 * mismatch and no extra render on every mount. The width of the first frame
 * comes from CSS (.platform-grid--auto), not from here.
 *
 * ponytail: `matchMedia?.()` because not every environment has it — jsdom without
 * a stub and an old browser fall back to `false`, which is the usual layout,
 * instead of taking down the whole page.
 */
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query);

      list?.addEventListener("change", onChange);

      return () => list?.removeEventListener("change", onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
