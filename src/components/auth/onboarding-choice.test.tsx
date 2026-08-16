import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingChoice } from "@/components/auth/onboarding-choice";

const mocks = vi.hoisted(() => ({
  // Stable identities: Next's real useRouter/useSearchParams keep the same
  // object across renders. Fresh literals here would change the effect deps on
  // every state update and re-subscribe, hiding the very bug under test.
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams(),
  getUserProfile: vi.fn(),
  listeners: [] as Array<(session: unknown) => void>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Stands in for the real Supabase subscription so a test can fire the auth
// callback as often as GoTrue would.
vi.mock("@/lib/auth/supabase-auth", () => ({
  listenToAuthState: (callback: (session: unknown) => void) => {
    mocks.listeners.push(callback);
    return () => {
      mocks.listeners = mocks.listeners.filter((entry) => entry !== callback);
    };
  },
  refreshCurrentUserEmailVerification: vi.fn(),
  sendSkillsetEmailVerification: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  completeUserOnboarding: vi.fn(),
}));

function emitAuthenticated() {
  for (const listener of mocks.listeners) {
    listener({
      status: "authenticated",
      user: { uid: "learner-1", displayName: "Patrick", emailVerified: true },
    });
  }
}

describe("OnboardingChoice bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners = [];
    mocks.getUserProfile.mockResolvedValue(null);
  });

  // Supabase re-fires onAuthStateChange on TOKEN_REFRESHED / USER_UPDATED —
  // the hourly refresh, a tab regaining focus, the email-verification round
  // trip this screen itself triggers. The old code re-read the profile on
  // every one of those and pushed the stored values back into displayName,
  // username, bio, timezone and goals, silently wiping a half-filled form
  // under someone who was still typing in it.
  it("seeds the profile once, not on every later auth event", async () => {
    render(<OnboardingChoice />);

    await act(async () => {
      emitAuthenticated();
    });

    // Control: the first event must still seed, or the screen never loads.
    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitAuthenticated();
      emitAuthenticated();
    });

    expect(mocks.getUserProfile).toHaveBeenCalledTimes(1);
  });
});
