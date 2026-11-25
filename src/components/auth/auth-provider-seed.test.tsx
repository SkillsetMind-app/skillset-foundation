import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/components/auth/auth-provider";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import type { AuthSession } from "@/domain/auth";
import { currentPrivacyVersion, currentTermsVersion } from "@/lib/legal/versions";

const mocks = vi.hoisted(() => ({
  listenToAuthState: vi.fn(),
  getUserProfile: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/learn/courses/intro",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/supabase-auth", () => ({
  listenToAuthState: mocks.listenToAuthState,
  signOutOfSkillsetMind: vi.fn(),
  getSignupLegalVersions: vi.fn(),
}));
vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  acceptUserTerms: vi.fn(),
  acceptTeacherTerms: vi.fn(),
}));
vi.mock("@/lib/posthog/client", () => ({ identifyUser: vi.fn(), resetUser: vi.fn() }));

// The session the server resolved (lib/auth/server-session) reaches the
// provider as a prop. Proved here: the page is signed in from the very first
// render, on the server and in the browser alike, and hydrating that HTML is
// clean even with an admin preview waiting in sessionStorage.

function seed(roles: string[]): AuthSession {
  return {
    status: "authenticated",
    user: {
      uid: "u-1",
      email: "person@example.com",
      emailVerified: true,
      displayName: "Test Person",
      photoURL: null,
      roles: roles as never,
    },
  };
}

function Probe() {
  const { status, user } = useAuth();
  return (
    <>
      <p data-testid="status">{status}</p>
      <p data-testid="roles">{(user?.roles ?? []).join(",")}</p>
    </>
  );
}

function page(initialSession: AuthSession | null) {
  return (
    <I18nProvider initialLocale="en">
      <AuthProvider initialSession={initialSession}>
        <Probe />
        <ProtectedSurface permissions={["courses.viewLearning"]}>
          <p>protected content</p>
        </ProtectedSurface>
      </AuthProvider>
    </I18nProvider>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  mocks.listenToAuthState.mockReturnValue(Object.assign(() => {}, { refreshUser: vi.fn() }));
  // Terms already accepted: the legal window stays out of the way.
  mocks.getUserProfile.mockResolvedValue({
    uid: "u-1",
    roles: ["student"],
    termsVersion: currentTermsVersion,
    privacyVersion: currentPrivacyVersion,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthProvider with a session resolved on the server", () => {
  it("the server HTML is the signed-in page, not the waiting skeleton", () => {
    const html = renderToString(page(seed(["student"])));
    expect(html).toContain("protected content");
    expect(html).toContain('data-testid="status">authenticated<');
  });

  it("without a session from the server the HTML is still the waiting state", () => {
    const html = renderToString(page(null));
    expect(html).not.toContain("protected content");
    expect(html).toContain('data-testid="status">loading<');
  });

  it("starts signed in and seeds the listener with the same session", async () => {
    const session = seed(["student"]);
    await act(async () => {
      render(page(session));
    });

    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    expect(screen.getByText("protected content")).toBeTruthy();
    expect(mocks.listenToAuthState).toHaveBeenCalledWith(expect.any(Function), session);
  });

  it("without a session from the server the listener is not seeded", async () => {
    await act(async () => {
      render(page(null));
    });

    expect(screen.getByTestId("status").textContent).toBe("loading");
    expect(mocks.listenToAuthState).toHaveBeenCalledWith(expect.any(Function), null);
  });

  it("a provider that mounts again later does not start from the same handed-over session", async () => {
    // After the root error boundary resets, the layout hands the same object
    // again. Someone may have signed out or switched accounts since: the new
    // provider starts from "loading" and lets the browser answer.
    const session = seed(["student"]);
    let first!: ReturnType<typeof render>;
    await act(async () => {
      first = render(page(session));
    });
    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    await act(async () => first.unmount());

    await act(async () => {
      render(page(session));
    });
    expect(screen.getByTestId("status").textContent).toBe("loading");
    expect(mocks.listenToAuthState).toHaveBeenLastCalledWith(expect.any(Function), null);
  });

  it("React's development double-run of effects keeps the page signed in", async () => {
    // StrictMode mounts, unmounts and mounts the effect again. The second
    // listener must start from the same session, not flash "loading".
    const session = seed(["student"]);
    await act(async () => {
      render(<StrictMode>{page(session)}</StrictMode>);
    });

    expect(screen.getByTestId("status").textContent).toBe("authenticated");
    expect(mocks.listenToAuthState.mock.calls.map((call) => call[1])).toEqual([session, session]);
  });

  it("an admin preview still applies when sessionStorage refuses the write", async () => {
    const session = seed(["admin"]);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    function Chooser() {
      const { setViewAsRole } = useAuth();
      return (
        <>
          <button onClick={() => setViewAsRole("student")}>preview</button>
          <button onClick={() => setViewAsRole(null)}>exit</button>
        </>
      );
    }
    await act(async () => {
      render(
        <I18nProvider initialLocale="en">
          <AuthProvider initialSession={session}>
            <Probe />
            <Chooser />
          </AuthProvider>
        </I18nProvider>,
      );
    });

    await act(async () => screen.getByText("preview").click());
    expect(screen.getByTestId("roles").textContent).toBe("student");

    // Storage works again: leaving the preview clears the in-memory choice too.
    setItem.mockRestore();
    await act(async () => screen.getByText("exit").click());
    expect(screen.getByTestId("roles").textContent).toBe("admin");
  });

  it("hydrates cleanly when an admin has a preview stored, then applies it", async () => {
    const session = seed(["admin", "teacher"]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(page(session));
    expect(container.querySelector('[data-testid="roles"]')?.textContent).toBe("admin,teacher");

    // What the browser has that the server could not see.
    window.sessionStorage.setItem("skillsetmind.viewAs", "student");
    const recoverable: unknown[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, page(session), {
        onRecoverableError: (error) => recoverable.push(error),
      });
    });

    expect(recoverable).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="roles"]')?.textContent).toBe("student");

    await act(async () => root.unmount());
    errors.mockRestore();
    container.remove();
  });
});
