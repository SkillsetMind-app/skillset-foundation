import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingChoice } from "@/components/auth/onboarding-choice";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// Accepting the teacher terms publishes the profile (20261006020000): the screen says
// what becomes public and where, next to the terms checkbox.
const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams("path=teacher"),
  getUserProfile: vi.fn(),
  listeners: [] as Array<(session: unknown) => void>,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ refreshUser: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));
vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => translate(getDictionary("en"), key) }),
}));
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

async function signIn() {
  await act(async () => {
    for (const listener of mocks.listeners) {
      listener({ status: "authenticated", user: { uid: "teacher-1", displayName: "Ana", emailVerified: true } });
    }
  });
}

describe("OnboardingChoice: the teacher profile is public", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners = [];
  });
  afterEach(cleanup);

  it("quick activation: states the address with the @ the teacher already has", async () => {
    mocks.getUserProfile.mockResolvedValue({
      onboardingCompleted: true,
      onboardingPath: "teacher",
      roles: ["student"],
      goals: [],
      username: "ana",
    });
    render(<OnboardingChoice />);
    await signIn();

    expect(await screen.findByText(
      "Your teacher profile (name, photo, bio and credentials) is public at skillsetmind.com/@ana.",
    )).toBeInTheDocument();
  });

  // O-22: the quick activation has no @ field. Without one, the example "@your-name"
  // looked like the person's address; the notice that the profile is public stays.
  it("quick activation without @: says it is public without inventing the address", async () => {
    mocks.getUserProfile.mockResolvedValue({
      onboardingCompleted: true,
      onboardingPath: "teacher",
      roles: ["student"],
      goals: [],
      username: null,
    });
    render(<OnboardingChoice />);
    await signIn();

    expect(await screen.findByText(
      "Your teacher profile (name, photo, bio and credentials) is public on SkillsetMind.",
    )).toBeInTheDocument();
    expect(screen.queryByText(/@your-name/)).toBeNull();
  });

  it("full flow, before choosing the @: shows the address format", async () => {
    mocks.getUserProfile.mockResolvedValue(null);
    render(<OnboardingChoice />);
    await signIn();

    expect(await screen.findByText(
      "Your teacher profile (name, photo, bio and credentials) is public at skillsetmind.com/@your-name.",
    )).toBeInTheDocument();
  });
});
