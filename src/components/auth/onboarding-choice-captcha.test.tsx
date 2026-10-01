import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingChoice } from "@/components/auth/onboarding-choice";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  searchParams: new URLSearchParams("path=teacher"),
  getUserProfile: vi.fn(),
  sendSkillsetEmailVerification: vi.fn(),
  listeners: [] as Array<(session: unknown) => void>,
  resetSignals: [] as number[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/auth/supabase-auth", () => ({
  listenToAuthState: (callback: (session: unknown) => void) => {
    mocks.listeners.push(callback);
    return () => {
      mocks.listeners = mocks.listeners.filter((entry) => entry !== callback);
    };
  },
  refreshCurrentUserEmailVerification: vi.fn(),
  sendSkillsetEmailVerification: mocks.sendSkillsetEmailVerification,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
  completeUserOnboarding: vi.fn(),
}));

// Turnstile with the site key SET: hands over a token on mount and a fresh one
// after every reset, like the real widget once the challenge auto-solves.
vi.mock("@/components/auth/turnstile-widget", async () => {
  const { useEffect } = await import("react");
  return {
    isCaptchaEnabled: true,
    TurnstileWidget: ({
      onToken,
      resetSignal = 0,
    }: {
      onToken: (token: string) => void;
      resetSignal?: number;
    }) => {
      useEffect(() => {
        mocks.resetSignals.push(resetSignal);
        onToken(`cf-${resetSignal}`);
      }, [onToken, resetSignal]);
      return null;
    },
  };
});

async function signInUnverified() {
  await act(async () => {
    for (const listener of mocks.listeners) {
      listener({
        status: "authenticated",
        user: { uid: "teacher-1", displayName: "Patrick", emailVerified: false },
      });
    }
  });
}

// With CAPTCHA protection on, GoTrue refuses a resend without a token, and
// this screen had no widget, so "send verification email" always failed.
describe("OnboardingChoice verification resend with CAPTCHA protection on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listeners = [];
    mocks.resetSignals = [];
    mocks.sendSkillsetEmailVerification.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("sends the captcha token from the full onboarding flow", async () => {
    mocks.getUserProfile.mockResolvedValue(null);
    render(<OnboardingChoice />);
    await signInUnverified();

    fireEvent.click(await screen.findByRole("button", { name: "onboarding.sendVerification" }));

    await waitFor(() =>
      expect(mocks.sendSkillsetEmailVerification).toHaveBeenCalledWith("cf-0"),
    );
    await waitFor(() => expect(mocks.resetSignals).toContain(1));
  });

  it("sends the captcha token from the streamlined teacher activation", async () => {
    mocks.getUserProfile.mockResolvedValue({
      onboardingCompleted: true,
      onboardingPath: "teacher",
      roles: ["student"],
      goals: [],
    });
    render(<OnboardingChoice />);
    await signInUnverified();

    await screen.findByText("onboarding.streamlinedTitle");
    fireEvent.click(screen.getByRole("button", { name: "onboarding.sendVerification" }));

    await waitFor(() =>
      expect(mocks.sendSkillsetEmailVerification).toHaveBeenCalledWith("cf-0"),
    );
    await waitFor(() => expect(mocks.resetSignals).toContain(1));
  });
});
