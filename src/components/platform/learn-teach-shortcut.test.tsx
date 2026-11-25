import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { MobileSidebarDrawer } from "@/components/platform/mobile-sidebar-drawer";
import { PlatformHeader } from "@/components/platform/platform-header";
import { PlatformNav } from "@/components/platform/platform-nav";

// Switching sides (learner <-> teacher). Before: a link at the bottom of the sidebar,
// "Switch view" hidden in the avatar menu, and the public site shortcut opened a
// NEW TAB — for someone with little familiarity with the internet, a new tab means "the
// site vanished". Now: ONE visible button at the top, in the same tab; on a phone, the
// side's name at the top and the shortcut to the other side on the bottom bar.

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
  roles: ["teacher"] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "u-1",
      email: "person@example.com",
      displayName: "Person",
      emailVerified: true,
      photoURL: null,
      roles: mocks.roles,
    },
    signOut: vi.fn(),
  }),
}));

vi.mock("@/components/platform/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/shared/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/lib/data/user-profiles", () => ({ subscribeToUserProfile: () => () => {} }));

afterEach(() => {
  cleanup();
  mocks.pathname = "/teach";
  mocks.roles = ["teacher"];
});

describe("side-switch button at the top", () => {
  it.each([
    ["/teach", "Go to student area", "/learn", "Teacher"],
    ["/teach/sales", "Go to student area", "/learn", "Teacher"],
    ["/account/payments", "Go to student area", "/learn", "Teacher"],
    ["/learn", "Go to teacher area", "/teach", "Student"],
    ["/learn/messages", "Go to teacher area", "/teach", "Student"],
  ])("in %s: '%s' leads to %s in the same tab", (pathname, label, href, side) => {
    mocks.pathname = pathname;
    const { container } = render(<PlatformHeader />);

    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", href);
    expect(link).not.toHaveAttribute("target");
    // Below 1280px only the icon appears: the full name stays in the aria-label
    // (screen reader), in the title (mouse hint) and in the hidden text.
    expect(link).toHaveAttribute("aria-label", label);
    expect(link).toHaveAttribute("title", label);
    expect(link.querySelector(".platform-topbar__switch-label")).toHaveTextContent(label);
    // The phone shows which side the person is on, in a single word.
    expect(container.querySelector(".platform-topbar__side")).toHaveTextContent(new RegExp(`^${side}$`));
  });

  it.each([
    ["/teach", "Ir al área del alumno", "/learn", "Profesor"],
    ["/learn", "Ir al área del profesor", "/teach", "Alumno"],
  ])("in Spanish, in %s: '%s' is the side '%s'", (pathname, label, href, side) => {
    mocks.pathname = pathname;
    const { container } = render(
      <I18nProvider initialLocale="es">
        <PlatformHeader />
      </I18nProvider>,
    );

    expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    // "Área del alumno" and "Área del profesor" both got cut to "ÁREA D…".
    expect(container.querySelector(".platform-topbar__side")).toHaveTextContent(new RegExp(`^${side}$`));
  });

  // The account menu listed "Switch area -> Student area", the same destination as the
  // button beside it. On the platform the top keeps the switch; the public site, which
  // has no button, keeps it in the menu (account-menu.test).
  it.each([
    ["/teach", "Student area"],
    ["/learn", "Teacher area"],
  ])("in %s the account menu does not repeat the destination of the top button (%s)", (pathname, duplicate) => {
    mocks.pathname = pathname;
    render(<PlatformHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));

    expect(document.getElementById("account-menu-panel")).not.toBeNull();
    expect(screen.queryByRole("link", { name: duplicate })).toBeNull();
    expect(screen.queryByText("Switch area")).toBeNull();
  });

  it("someone who only studies sees no switch button, but sees which side they are on", () => {
    mocks.roles = ["student"];
    mocks.pathname = "/learn";
    const { container } = render(<PlatformHeader />);

    expect(screen.queryByRole("link", { name: /Go to (teacher|student) area/ })).toBeNull();
    expect(container.querySelector(".platform-topbar__side")).toHaveTextContent("Student");
  });

  it("the sidebar does not repeat the switch: no 'Teach' at the bottom of the learner one, no 'My courses' at the bottom of the teacher one", () => {
    mocks.pathname = "/learn";
    const { unmount } = render(<PlatformNav />);
    expect(document.querySelector('.platform-sidebar-nav a[href="/teach"]')).toBeNull();
    unmount();

    mocks.pathname = "/teach";
    render(<PlatformNav />);
    expect(document.querySelector('.platform-sidebar-nav a[href="/learn"]')).toBeNull();
  });
});

// Help left the studio top and the learner area: it lives in the sidebar
// (on a phone, in the drawer). One per screen — see uma-ajuda-por-tela.test.
describe("the top has no Help", () => {
  it.each(["/teach/sales", "/learn", "/ops"])("in %s", (pathname) => {
    mocks.pathname = pathname;
    mocks.roles = pathname === "/ops" ? ["admin"] : ["teacher"];
    render(<PlatformHeader />);

    expect(within(screen.getByRole("banner")).queryByRole("button", { name: "Help" })).toBeNull();
  });
});

// On a phone the side switch lives on the bottom bar, and the account menu no longer
// repeats it. The top and the bar each calculate the destination on their own: this test
// locks the two together, so an edit on one side does not remove the only switch on the
// phone with nobody noticing.
describe("bottom bar and top lead to the same other side", () => {
  it.each(
    [["student"], ["teacher"], ["admin", "teacher"]].flatMap((roles) =>
      ["/teach", "/learn", "/ops"].map((pathname) => [roles.join("+"), pathname, roles] as const),
    ),
  )("%s in %s", (_label, pathname, roles) => {
    mocks.pathname = pathname;
    mocks.roles = [...roles];
    const { container } = render(
      <>
        <PlatformHeader />
        <MobileSidebarDrawer open={false} onOpen={vi.fn()} onClose={vi.fn()} />
      </>,
    );

    const headerTarget = container.querySelector(".platform-topbar__switch")?.getAttribute("href") ?? null;
    const bar = screen.getByRole("navigation", { name: "Mobile platform navigation" });
    const barTargets = within(bar).getAllByRole("link").map((link) => link.getAttribute("href"));
    if (headerTarget) {
      expect(barTargets).toContain(headerTarget);
    } else {
      // Someone who only studies has no switch at the top, nor a studio shortcut on the bar
      // (Home follows the address, which is why the name and not the href).
      expect(roles).toEqual(["student"]);
      expect(within(bar).queryByRole("link", { name: "Teach" })).toBeNull();
    }
  });
});

describe("phone bottom bar: the shortcut is always the OTHER side", () => {
  it.each([
    ["/teach", "Learn", "/learn"],
    ["/learn", "Teach", "/teach"],
  ])("in %s shows '%s'", (pathname, label, href) => {
    mocks.pathname = pathname;
    render(<MobileSidebarDrawer open={false} onOpen={vi.fn()} onClose={vi.fn()} />);

    const bar = screen.getByRole("navigation", { name: "Mobile platform navigation" });
    const link = within(bar).getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", href);
    expect(link).not.toHaveAttribute("target");
  });
});
