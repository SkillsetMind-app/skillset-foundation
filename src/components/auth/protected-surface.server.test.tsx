// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { SidebarPreferenceProvider } from "@/lib/ui/sidebar-preference";

// The guard wait is the HTML the server sends for the 39 protected
// pages (the session is "loading" on the server). Here there is no window or
// document: if the wait read them while rendering, this would break, and in the browser
// it would be a hydration mismatch.
const mocks = vi.hoisted(() => ({ pathname: "/teach/sales" }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "loading", user: null }),
}));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

function serverHtml(pathname: string, pref: "collapsed" | "expanded" | null) {
  mocks.pathname = pathname;
  return renderToString(
    <SidebarPreferenceProvider value={pref}>
      <ProtectedSurface permissions={["teacherStudio.access"]}>
        <p>conteudo protegido</p>
      </ProtectedSurface>
    </SidebarPreferenceProvider>,
  );
}

describe("ProtectedSurface on the server", () => {
  it("runs without window or document", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("the shell comes out with the bar the layout read from the cookie, one notice only", () => {
    const collapsed = serverHtml("/teach/sales", "collapsed");
    expect(collapsed).toContain("platform-grid platform-grid--collapsed");
    expect(collapsed).toContain("sidebar-collapsed");
    expect(collapsed.match(/role="status"/g)).toHaveLength(1);
    expect(collapsed.match(/<h1[ >]/g)).toHaveLength(1);
    expect(collapsed).toContain('<h1 class="sr-only">authFlow.loading.title</h1>');
    expect(collapsed).not.toContain("conteudo protegido");
    expect(collapsed).not.toMatch(/<a |<button/);

    // With no saved choice: CSS decides the width by screen, already on the 1st frame.
    expect(serverHtml("/teach/sales", null)).toContain("platform-grid--auto");
    expect(serverHtml("/teach/sales", "expanded")).toContain("sidebar-expanded");
  });

  it("outside the shell, the usual ring", () => {
    const html = serverHtml("/learn/courses/intro", null);
    expect(html).not.toContain("platform-grid");
    expect(html).toContain("authFlow.loading.title</h1>");
  });
});
