import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusBanner } from "@/components/platform/status-banner";
import { StripeConnectNotice } from "@/components/teacher/stripe-connect-notice";

// The Stripe notice was a FIXED yellow banner at the top of all of /teach, which only
// went away when the account connected: days or weeks of a permanent alert, which
// is the same as no alert. It became a dismissible line, only where money is
// discussed, that disappears by itself when charges and payouts are enabled.

const mocks = vi.hoisted(() => ({
  // true: the profile has not arrived yet (the subscription does not respond).
  profilePending: false,
  // true: the profile read fails.
  profileFails: false,
  // Terms already accepted on purpose: without this the terms banner fires first and
  // the "the fixed banner no longer exists" test would pass even with the Stripe branch
  // back in place.
  profile: {
    teacherTermsAcceptedAt: "2026-01-01T00:00:00.000Z",
    stripeConnectChargesEnabled: false,
    stripeConnectPayoutsEnabled: false,
  } as Record<string, unknown>,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      uid: "teacher-1",
      email: "teacher@example.com",
      displayName: "Teacher",
      emailVerified: true,
      photoURL: null,
      roles: ["teacher"],
    },
  }),
}));

vi.mock("@/components/i18n/i18n-provider", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "platform.banner.connectPayouts":
          "Connect your Stripe account before selling paid courses - buyers are charged on it directly.",
        "platform.banner.connectPayoutsCta": "Connect Stripe",
        "platform.banner.dismissNotice": "Dismiss this notice",
      })[key] ?? key,
  }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (
    _uid: string,
    onData: (profile: Record<string, unknown>) => void,
    onError?: (error: Error) => void,
  ) => {
    if (mocks.profileFails) onError?.(new Error("offline"));
    else if (!mocks.profilePending) onData(mocks.profile);
    return () => undefined;
  },
}));

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  mocks.profilePending = false;
  mocks.profileFails = false;
  mocks.profile = {
    teacherTermsAcceptedAt: "2026-01-01T00:00:00.000Z",
    stripeConnectChargesEnabled: false,
    stripeConnectPayoutsEnabled: false,
  };
});

afterEach(cleanup);

describe("Stripe notice on the sales screens", () => {
  it("the fixed banner at the top no longer exists", async () => {
    render(<StatusBanner />);

    await waitFor(() => {
      expect(screen.queryByText(/Connect your Stripe account/)).toBeNull();
    });
  });

  it("says the money goes straight to the teacher's account, with a path to connect", async () => {
    render(<StripeConnectNotice />);

    expect(
      await screen.findByText(/buyers are charged on it directly/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Stripe" })).toHaveAttribute(
      "href",
      "/account/payments#stripe-connect",
    );
  });

  it("disappears when dismissed and does not come back this session", async () => {
    const { unmount } = render(<StripeConnectNotice />);

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss this notice" }));
    expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();

    unmount();
    render(<StripeConnectNotice />);

    await waitFor(() => {
      expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();
    });
  });

  // The notice waited for the profile and pushed the sales list 117px down.
  describe("before the profile arrives", () => {
    const remember = (uid: string, ready: boolean) =>
      window.localStorage.setItem("skillset:stripe-connect-notice-last", JSON.stringify({ uid, ready }));

    it("someone who had not connected on the last visit sees the notice from the first frame", () => {
      mocks.profilePending = true;
      remember("teacher-1", false);
      render(<StripeConnectNotice />);

      expect(screen.getByText(/buyers are charged on it directly/)).toBeInTheDocument();
    });

    it.each([
      ["no previous visit", null],
      ["account already connected on the last visit", { uid: "teacher-1", ready: true }],
      ["the last visit was by another person", { uid: "someone-else", ready: false }],
    ])("%s: nothing until the profile arrives", (_label, saved) => {
      mocks.profilePending = true;
      if (saved) remember(saved.uid, saved.ready);
      render(<StripeConnectNotice />);

      expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();
    });

    it("profile read failed: the last-visit mark is not enough to assert", () => {
      mocks.profileFails = true;
      remember("teacher-1", false);
      render(<StripeConnectNotice />);

      expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();
    });

    it("connected since the last visit: the notice disappears when the profile arrives and the mark flips", async () => {
      remember("teacher-1", false);
      mocks.profile = { ...mocks.profile, stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true };
      render(<StripeConnectNotice />);

      await waitFor(() => {
        expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();
      });
      expect(JSON.parse(window.localStorage.getItem("skillset:stripe-connect-notice-last") ?? "{}")).toEqual({
        uid: "teacher-1",
        ready: true,
      });
    });
  });

  it("does not appear when the account is already connected", async () => {
    mocks.profile = {
      teacherTermsAcceptedAt: "2026-01-01T00:00:00.000Z",
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    };
    render(<StripeConnectNotice />);

    await waitFor(() => {
      expect(screen.queryByText(/buyers are charged on it directly/)).toBeNull();
    });
  });
});
