import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadingScreen } from "@/components/auth/loading-screen";

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  searchParams: new URLSearchParams(
    "next=welcome&path=teacher&returnTo=%2Fteach%2Fsettings",
  ),
  getUserProfile: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "mfa_required", user: null }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  getUserProfile: mocks.getUserProfile,
}));

// /loading holds the spinner for 1.4s before routing; wait longer than that.
const ROUTED = { timeout: 4000 };

// A-17: the post-login router sent any session with a user to the
// content. Password accepted and code not yet presented must land on the
// code screen — carrying the path and deep link along, so they are not lost.
describe("LoadingScreen with a pending second factor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("sends to the code screen with path and deep link, never to the content", async () => {
    render(<LoadingScreen />);

    await waitFor(
      () =>
        expect(mocks.router.replace).toHaveBeenCalledWith(
          "/login?path=teacher&returnTo=%2Fteach%2Fsettings",
        ),
      ROUTED,
    );
    expect(mocks.getUserProfile).not.toHaveBeenCalled();
  });
});
