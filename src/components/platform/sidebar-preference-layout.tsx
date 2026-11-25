import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { parseSidebarPref, SIDEBAR_COOKIE } from "@/lib/ui/sidebar-cookie";
import { SidebarPreferenceProvider } from "@/lib/ui/sidebar-preference";

/**
 * Layout of the areas with the sidebar (/learn, /teach, /account, /ops,
 * /support): reads the bar's cookie on the server, and the first HTML already comes out open
 * or collapsed as the person left it (no flicker). It lives here, and not in the root
 * layout, so the home, the sales pages and the marketplace do not carry any
 * of the bar's code. Without a cookie, the CSS decides by screen width.
 */
export default async function SidebarPreferenceLayout({ children }: { children: ReactNode }) {
  const pref = parseSidebarPref((await cookies()).get(SIDEBAR_COOKIE)?.value);
  return <SidebarPreferenceProvider value={pref}>{children}</SidebarPreferenceProvider>;
}
