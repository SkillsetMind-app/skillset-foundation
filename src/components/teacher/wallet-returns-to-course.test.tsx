import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";

// The teacher left Publish for "Set up how you get paid" (before "Finish payout onboarding"), went through the
// Stripe screens and landed on a status line, with no way back to the
// course. The builder sends ?returnTo=; with payments ready, it becomes a button.

// STABLE references: the panel subscribes to profile and ledger with `[user]`.
const mocks = vi.hoisted(() => ({
  user: { uid: "teacher-1" },
  profile: {} as Record<string, unknown>,
  ledger: [] as unknown[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (_uid: string, onData: (profile: Record<string, unknown>) => void) => {
    onData(mocks.profile);
    return () => undefined;
  },
}));
vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (_uid: string, onData: (entries: unknown[]) => void) => {
    onData(mocks.ledger);
    return () => undefined;
  },
}));
vi.mock("@/lib/data/creator-verification", () => ({
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));
vi.mock("@/lib/payments/connect", () => ({
  isConnectNotEnabledError: () => false,
  refreshTeacherStripeAccountStatus: () => Promise.resolve({ chargesEnabled: true, payoutsEnabled: true }),
}));
vi.mock("@/components/teacher/teacher-connect-onboarding", () => ({
  TeacherConnectOnboarding: () => <div data-testid="stripe-onboarding" />,
}));
vi.mock("@/components/teacher/stripe-dashboard-button", () => ({
  StripeDashboardButton: () => null,
}));

const builderPublish = "/teach/builder?courseId=course-1&tab=review";
const ready = { stripeConnectedAccountId: "acct_1", stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true };

function openAt(search: string) {
  window.history.replaceState(null, "", `/account/payments${search}`);
  return render(
    <I18nProvider initialLocale="en">
      <TeacherWalletPanel />
    </I18nProvider>,
  );
}

const back = () => screen.queryByRole("link", { name: "Back to your course to publish" });

describe("wallet: back to the course after payments", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    mocks.profile = {};
  });

  it("payments ready and returnTo from the builder: back button to the Publish tab", () => {
    mocks.profile = ready;
    openAt(`?returnTo=${encodeURIComponent(builderPublish)}`);
    expect(back()).toHaveAttribute("href", builderPublish);
  });

  it("payments still pending: no button, the person finishes signing up first", () => {
    mocks.profile = { stripeConnectedAccountId: "acct_1" };
    openAt(`?returnTo=${encodeURIComponent(builderPublish)}`);
    expect(back()).toBeNull();
  });

  it.each([
    "https://evil.example/teach/builder?x=1",
    "//evil.example/teach/builder?x=1",
    "/\\evil.example",
    "/account/billing",
    "/teach/builderx?courseId=1",
  ])("a destination that is not the builder (%s) does not become a button", (target) => {
    mocks.profile = ready;
    openAt(`?returnTo=${encodeURIComponent(target)}`);
    expect(back()).toBeNull();
  });

  it("without returnTo, nothing changes", () => {
    mocks.profile = ready;
    openAt("");
    expect(back()).toBeNull();
  });
});
