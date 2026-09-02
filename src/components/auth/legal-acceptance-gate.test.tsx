import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "@/components/auth/auth-provider";
import {
  currentPrivacyVersion,
  currentTermsVersion,
} from "@/lib/legal/versions";

const mocks = vi.hoisted(() => ({
  pathname: "/learn",
  listenToAuthState: vi.fn(),
  getUserProfile: vi.fn(),
  acceptUserTerms: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

vi.mock("@/lib/auth/supabase-auth", () => ({
  listenToAuthState: mocks.listenToAuthState,
  signOutOfSkillsetMind: vi.fn(),
  getCurrentAuthSession: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  acceptUserTerms: mocks.acceptUserTerms,
}));

vi.mock("@/lib/posthog/client", () => ({
  identifyUser: vi.fn(),
  resetUser: vi.fn(),
}));

const ACCEPT = "Accept and continue";

function renderSignedIn() {
  mocks.listenToAuthState.mockImplementation(
    (setSession: (next: unknown) => void) => {
      setSession({
        status: "authenticated",
        user: {
          uid: "u-1",
          email: "person@example.com",
          displayName: "Test Person",
          roles: ["student"],
          termsAcceptedVersion: null,
          privacyAcceptedVersion: null,
        },
      });
      return () => {};
    },
  );
  return render(
    <AuthProvider>
      <p>page</p>
    </AuthProvider>,
  );
}

// The signup form treats its post-signup writes as best-effort and relies on
// this gate to re-collect the terms when one of them failed. These tests pin
// that contract so the recovery path can't silently disappear.
describe("LegalAcceptanceGate as the signup recovery path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mocks.pathname = "/learn";
    mocks.acceptUserTerms.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("asks for the terms again when the profile has none and records them", async () => {
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: null,
      privacyVersion: null,
      marketingConsent: false,
    });
    renderSignedIn();

    const accept = await screen.findByRole("button", { name: ACCEPT });
    const [terms, privacy] = screen.getAllByRole("checkbox");
    fireEvent.click(terms);
    fireEvent.click(privacy);
    fireEvent.click(accept);

    await waitFor(() =>
      expect(mocks.acceptUserTerms).toHaveBeenCalledWith("u-1", false),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull(),
    );
  });

  it("stays out of the way on /welcome so onboarding finishes first", async () => {
    mocks.pathname = "/welcome";
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: null,
      privacyVersion: null,
      marketingConsent: false,
    });
    renderSignedIn();

    await waitFor(() => expect(mocks.getUserProfile).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
  });

  it("does not interrupt a profile whose terms are current", async () => {
    mocks.getUserProfile.mockResolvedValue({
      termsVersion: currentTermsVersion,
      privacyVersion: currentPrivacyVersion,
      marketingConsent: false,
    });
    renderSignedIn();

    await waitFor(() => expect(mocks.getUserProfile).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: ACCEPT })).toBeNull();
  });
});
