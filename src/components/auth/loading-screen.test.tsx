import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadingScreen } from "@/components/auth/loading-screen";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  searchParams: new URLSearchParams(),
  getUserProfile: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: { uid: "u-1" } }),
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
});
