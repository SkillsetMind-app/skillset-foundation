import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformShell } from "@/components/platform/platform-shell";

// F-03, stage 0: the guard's wait draws the platform shell with the
// SAME classes as PlatformShell. Here each protected route that opens in the shell
// is drawn twice (the wait and the real shell) and the pieces that give
// width and breathing room must come out equal: swapping one for the other does not jump.

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
  session: { status: "loading", user: null } as {
    status: string;
    user: { uid: string; displayName: string; roles: string[] } | null;
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => mocks.session }));
vi.mock("./platform-header", () => ({ PlatformHeader: () => null }));
vi.mock("./status-banner", () => ({ StatusBanner: () => null }));
vi.mock("@/components/teacher/use-teacher-inbox-count", () => ({ useTeacherInboxCount: () => undefined }));

const teacher = { uid: "teacher-test", displayName: "Teacher", roles: ["teacher", "student"] };

function layout(container: HTMLElement) {
  return {
    grid: container.querySelector(".platform-grid")?.className,
    sidebar: container.querySelector(".platform-sidebar")?.className,
    main: container.querySelector(".platform-main-column")?.className,
    frame: container.querySelector(".platform-content")?.firstElementChild?.className,
  };
}

function waitLayout(pathname: string) {
  mocks.pathname = pathname;
  mocks.session = { status: "loading", user: null };
  const { container } = render(
    <I18nProvider initialLocale="en">
      <ProtectedSurface permissions={["auth.signOut"]}>
        <p>conteudo</p>
      </ProtectedSurface>
    </I18nProvider>,
  );
  const result = layout(container);
  cleanup();
  return result;
}

function shellLayout(pathname: string) {
  mocks.pathname = pathname;
  mocks.session = { status: "authenticated", user: teacher };
  const { container } = render(
    <I18nProvider initialLocale="en">
      <PlatformShell title="Page">conteudo</PlatformShell>
    </I18nProvider>,
  );
  const result = layout(container);
  cleanup();
  return result;
}

afterEach(() => {
  cleanup();
  document.cookie = "skillset_sidebar=; path=/; max-age=0";
});

// Every page that calls the guard and opens in PlatformShell, one per route pattern.
const shellRoutes = [
  "/teach",
  "/teach/sales",
  "/teach/sales/order-1",
  "/teach/builder",
  "/teach/courses/c-1/manage",
  "/teach/activate",
  "/account",
  "/account/payments",
  "/account/billing",
  "/account/billing/upgrade",
  "/account/billing/return",
  "/account/plans",
  "/learn",
  "/learn/events",
  "/learn/credentials",
  "/ops",
  "/ops/users/u-1",
  "/support",
];

describe("the wait and the real shell have the same frame", () => {
  it.each(shellRoutes)("%s, with no saved choice", (pathname) => {
    const wait = waitLayout(pathname);
    const shell = shellLayout(pathname);

    expect(wait.grid).toBeDefined();
    expect(wait.grid).toBe(shell.grid);
    expect(wait.sidebar).toBe(shell.sidebar);
    expect(wait.main).toBe(shell.main);
    // The 1280px column: on the same routes, and only on them.
    expect(wait.frame).toBe(shell.frame);
  });

  it.each(["collapsed", "expanded"])("with the %s sidebar chosen", (pref) => {
    document.cookie = `skillset_sidebar=${pref}; path=/`;
    const wait = waitLayout("/teach/sales");
    const shell = shellLayout("/teach/sales");

    expect(wait.grid).toBe(shell.grid);
    expect(wait.sidebar).toBe(shell.sidebar);
  });
});
