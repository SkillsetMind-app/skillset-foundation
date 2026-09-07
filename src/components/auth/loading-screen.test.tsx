import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadingScreen } from "@/components/auth/loading-screen";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  searchParams: new URLSearchParams(),
  getUserProfile: vi.fn(),
  auth: { status: "authenticated", user: { uid: "u-1" } as { uid: string } | null },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
}));

// /loading keeps the spinner up for 1.4s before routing; wait past it.
const ROUTED = { timeout: 4000 };
const GOOGLE_RETURN =
  "next=welcome&path=student&returnTo=%2Flearn%2Fcourses%2Fx";

describe("LoadingScreen after a Google sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { status: "authenticated", user: { uid: "u-1" } };
  });

  afterEach(cleanup);

  it("sends an onboarded account to the deep link it came from", async () => {
    mocks.searchParams = new URLSearchParams(GOOGLE_RETURN);
    mocks.getUserProfile.mockResolvedValue({
      onboardingCompleted: true,
      roles: ["student"],
    });
    render(<LoadingScreen />);

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/learn/courses/x"),
      ROUTED,
    );
  });

  // Onboarding still runs first — but it now takes the deep link with it
  // instead of swallowing it. Dropping it here is how a first-time buyer used
  // to finish the wizard on a dashboard, never seeing the course again.
  it("sends a new account to onboarding and hands the deep link over", async () => {
    mocks.searchParams = new URLSearchParams(GOOGLE_RETURN);
    mocks.getUserProfile.mockResolvedValue({
      onboardingCompleted: false,
      roles: ["student"],
    });
    render(<LoadingScreen />);

    await waitFor(
      () =>
        expect(mocks.router.replace).toHaveBeenCalledWith(
          "/welcome?path=student&returnTo=%2Flearn%2Fcourses%2Fx",
        ),
      ROUTED,
    );
  });

  it("ignores a deep link that would leave the site", async () => {
    mocks.searchParams = new URLSearchParams(
      "next=welcome&path=student&returnTo=%2F%2Fevil.example",
    );
    mocks.getUserProfile.mockResolvedValue({
      onboardingCompleted: true,
      roles: ["student"],
    });
    render(<LoadingScreen />);

    await waitFor(
      () => expect(mocks.router.replace).toHaveBeenCalledWith("/learn"),
      ROUTED,
    );
  });

  it.each([
    ["student", "/onboarding?path=teacher"],
    ["teacher", "/teach"],
  ])("routes explicit teacher intent using the real %s role", async (role, expected) => {
    mocks.searchParams = new URLSearchParams("next=route&path=teacher");
    const profile = { onboardingCompleted: true, onboardingPath: "student", roles: [role] };
    mocks.getUserProfile.mockResolvedValue(profile);
    render(<LoadingScreen />);
    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith(expected), ROUTED);
    expect(profile.roles).toEqual([role]);
  });

  it("keeps an explicit checkout destination ahead of teacher intent", async () => {
    const checkout = "/courses/focus/checkout?offer=LAUNCH&priceId=price-1";
    mocks.searchParams = new URLSearchParams({ next: "route", path: "teacher", returnTo: checkout });
    mocks.getUserProfile.mockResolvedValue({ onboardingCompleted: true, roles: ["student"] });
    render(<LoadingScreen />);
    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith(checkout), ROUTED);
  });

  it("takes intent and checkout back to sign-in when the session is gone", async () => {
    const checkout = "/courses/focus/checkout?offer=LAUNCH&priceId=price-1";
    mocks.auth = { status: "unauthenticated", user: null };
    mocks.searchParams = new URLSearchParams({ next: "route", path: "student", returnTo: checkout });
    render(<LoadingScreen />);
    await waitFor(() => expect(mocks.router.replace).toHaveBeenCalledWith(
      "/auth?mode=signin&path=student&returnTo=%2Fcourses%2Ffocus%2Fcheckout%3Foffer%3DLAUNCH%26priceId%3Dprice-1",
    ), ROUTED);
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
  });
});
