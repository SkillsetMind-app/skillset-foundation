import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/components/auth/auth-provider";

const mocks = vi.hoisted(() => ({
  user: null as { uid: string; roles: string[] } | null,
  listenToAuthState: vi.fn(),
  signOut: vi.fn(),
  getCurrentAuthSession: vi.fn(),
  getUserProfile: vi.fn(),
  acceptUserTerms: vi.fn(),
  identifyUser: vi.fn(),
  resetUser: vi.fn(),
  usePathname: vi.fn(() => "/ops"),
}));

vi.mock("next/navigation", () => ({ usePathname: mocks.usePathname }));

vi.mock("@/lib/auth/supabase-auth", () => ({
  listenToAuthState: mocks.listenToAuthState,
  signOutOfSkillsetMind: mocks.signOut,
  getCurrentAuthSession: mocks.getCurrentAuthSession,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  acceptUserTerms: mocks.acceptUserTerms,
}));

vi.mock("@/lib/posthog/client", () => ({
  identifyUser: mocks.identifyUser,
  resetUser: mocks.resetUser,
}));

function RolesProbe() {
  const { user, viewAsRole, isRealAdmin } = useAuth();
  return (
    <>
      <p data-testid="roles">{(user?.roles ?? []).join(",")}</p>
      <p data-testid="viewAs">{viewAsRole ?? "none"}</p>
      <p data-testid="realAdmin">{String(isRealAdmin)}</p>
    </>
  );
}

function renderWith(roles: string[]) {
  mocks.listenToAuthState.mockImplementation(
    (setSession: (next: unknown) => void) => {
      setSession({
        status: "authenticated",
        user: {
          uid: "u-1",
          email: "person@example.com",
          displayName: "Test Person",
          roles,
          termsAcceptedVersion: null,
          privacyAcceptedVersion: null,
        },
      });
      return () => {};
    },
  );
  return render(
    // AuthProvider mounts ViewAsBanner itself, which is the point: the
    // preview follows you off this page, so the way out has to as well.
    <AuthProvider>
      <RolesProbe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("view-as preview", () => {
  it("does nothing for a non-admin, even with a preview already stored", () => {
    // The whole safety argument is that a preview can only narrow. A stored
    // value left behind by a demoted account must not turn into a role grant.
    window.sessionStorage.setItem("skillsetmind.viewAs", "admin");

    renderWith(["student"]);

    expect(screen.getByTestId("roles")).toHaveTextContent("student");
    expect(screen.getByTestId("viewAs")).toHaveTextContent("none");
    expect(screen.getByTestId("realAdmin")).toHaveTextContent("false");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("narrows an admin to the previewed role and can be exited", () => {
    window.sessionStorage.setItem("skillsetmind.viewAs", "student");

    renderWith(["admin", "teacher"]);

    // Admin and teacher both gone: the preview replaces the set rather than
    // adding to it, so no admin-only control can survive into the preview.
    expect(screen.getByTestId("roles")).toHaveTextContent("student");
    expect(screen.getByTestId("realAdmin")).toHaveTextContent("true");

    fireEvent.click(screen.getByRole("button", { name: /exit preview/i }));

    expect(screen.getByTestId("roles")).toHaveTextContent("admin,teacher");
    expect(window.sessionStorage.getItem("skillsetmind.viewAs")).toBeNull();
  });
});
