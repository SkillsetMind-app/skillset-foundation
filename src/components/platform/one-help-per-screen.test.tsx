import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberAreaShell } from "@/components/learn/member-area-shell";
import { PlatformShell } from "@/components/platform/platform-shell";

// Exactly ONE Help per screen. Before there were up to three identical ones at the same time
// (sidebar, top bar and avatar menu), and for someone with little practice with
// computers two identical buttons look like two different things.
//   - studio and learner area: in the sidebar (on the phone, in the drawer);
//   - classroom, which has no sidebar: at the top, with the course;
//   - operations: none.

const mocks = vi.hoisted(() => ({
  pathname: "/teach",
  roles: ["teacher"] as string[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "person-1",
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
vi.mock("@/components/platform/status-banner", () => ({ StatusBanner: () => null }));
vi.mock("@/components/shared/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/teacher/use-teacher-inbox-count", () => ({ useTeacherInboxCount: () => undefined }));
vi.mock("@/lib/data/user-profiles", () => ({ subscribeToUserProfile: () => () => {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  mocks.pathname = "/teach";
  mocks.roles = ["teacher"];
});

function helpTriggers() {
  return screen.queryAllByRole("button", { name: "Help" });
}

describe("one Help per screen", () => {
  it.each([
    ["estudio", "/teach/sales", ["teacher"], "My students"],
    ["area do aluno", "/learn", ["student"], "Private matter with the teacher"],
  ])("%s: only the sidebar's, not in the top bar or the account menu", (_label, pathname, roles, choice) => {
    mocks.pathname = pathname;
    mocks.roles = roles;
    render(<PlatformShell title="Page">Content</PlatformShell>);

    expect(helpTriggers()).toHaveLength(1);
    const sidebar = screen.getByRole("navigation", { name: "Workspace" });
    const help = within(sidebar).getByRole("button", { name: "Help" });
    expect(within(screen.getByRole("banner")).queryByRole("button", { name: "Help" })).toBeNull();

    // With the account menu open, there is still only one.
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
    expect(helpTriggers()).toHaveLength(1);

    fireEvent.click(help);
    expect(screen.getByRole("dialog", { name: "What do you need help with?" })).toHaveTextContent(choice);
  });

  it("operations: no Help, and never the learner's choices", () => {
    mocks.pathname = "/ops";
    mocks.roles = ["admin"];
    render(<PlatformShell title="Operations">Content</PlatformShell>);
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));

    expect(helpTriggers()).toHaveLength(0);
    expect(screen.queryByText("Question about a lesson")).toBeNull();
  });

  it.each([
    ["sem marca", null],
    ["com a marca do professor", { name: "Atelier Curie" }],
  ])("classroom (%s): only the top one, with the classroom's course", (_label, brand) => {
    mocks.pathname = "/learn/courses/curso-1";
    mocks.roles = ["student"];
    render(
      <MemberAreaShell brand={brand} course={{ href: "/learn/courses/curso-1", communityEnabled: true }}>
        <p>Lesson</p>
      </MemberAreaShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));

    expect(helpTriggers()).toHaveLength(1);
    fireEvent.click(helpTriggers()[0]);
    expect(
      within(screen.getByRole("dialog", { name: "What do you need help with?" }))
        .getByRole("link", { name: /Question about a lesson/ }),
    ).toHaveAttribute("href", "/learn/courses/curso-1/community");
  });

  // Tablet: the bar is an icon rail; its Help opens the drawer already on
  // Help, with focus inside the choices.
  it("in the tablet rail, Help opens the drawer with focus on the first choice", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("768px") && query.includes("1024px"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mocks.pathname = "/learn";
    mocks.roles = ["student"];
    render(<PlatformShell title="My courses">Content</PlatformShell>);

    expect(helpTriggers()).toHaveLength(1);
    fireEvent.click(helpTriggers()[0]);

    const choices = screen.getByRole("dialog", { name: "What do you need help with?" });
    const first = within(choices).getByRole("link", { name: /Question about a lesson/ });
    await waitFor(() => expect(first).toHaveFocus());
  });
});
