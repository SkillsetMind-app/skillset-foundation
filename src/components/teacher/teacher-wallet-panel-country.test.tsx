import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

// Wiring of the payouts panel to the REAL onboarding component: only Stripe's
// own SDK, the profile/ledger reads and the refresh call are faked, so the
// assertions are about which Connect route calls the panel lets through.
const mocks = vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_wallet_wiring");
  return {
    fetch: vi.fn(),
    initialize: vi.fn(),
    // Stable references: the panel's effects depend on `user`, and a fresh
    // object (or ledger array) per render resubscribes forever.
    user: { uid: "teacher-1" },
    ledger: [] as unknown[],
    profile: {
      mode: "pending" as "pending" | "data" | "error",
      value: null as Record<string, unknown> | null,
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/theme/theme-provider", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@stripe/connect-js", () => ({ loadConnectAndInitialize: mocks.initialize }));
vi.mock("@stripe/react-connect-js", () => ({
  ConnectComponentsProvider: ({ children }: { children: ReactNode }) => children,
  ConnectAccountOnboarding: () => <div data-testid="connect-onboarding-fixture" />,
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (
    _uid: string,
    onData: (profile: Record<string, unknown> | null) => void,
    onError: (error: Error) => void,
  ) => {
    if (mocks.profile.mode === "data") onData(mocks.profile.value);
    if (mocks.profile.mode === "error") onError(new Error("profile read failed"));
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
vi.mock("@/lib/payments/connect", async (original) => ({
  ...await original<object>(),
  refreshTeacherStripeAccountStatus: () =>
    Promise.resolve({ connected: false, chargesEnabled: false, payoutsEnabled: false }),
}));

function copy(key: string) {
  const result = translate(getDictionary("en"), key);
  expect(result).not.toBe(key);
  return result;
}
function sessionCalls() {
  return mocks.fetch.mock.calls.filter(([url]) => url === "/api/payments/connect/account-session");
}
function mount() {
  return render(<I18nProvider initialLocale="en"><TeacherWalletPanel /></I18nProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mode = "pending";
  mocks.profile.value = null;
  mocks.fetch.mockReset().mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ clientSecret: "synthetic-connect" }), { status: 200 })));
  mocks.initialize.mockReset().mockReturnValue({ update: vi.fn() });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
afterAll(() => vi.unstubAllEnvs());

it("mounts nothing that can create an account while the profile is loading", async () => {
  mount();
  await act(async () => {});
  expect(screen.queryByLabelText(copy("connectOnboarding.countryLabel"))).toBeNull();
  expect(screen.queryByText(copy("connectOnboarding.preparing"))).toBeNull();
  expect(sessionCalls()).toHaveLength(0);
});

it("asks a creator without an account for the country and calls Connect only after Continue", async () => {
  mocks.profile.mode = "data";
  mocks.profile.value = { uid: "teacher-1", stripeConnectedAccountId: null };
  mount();
  expect(screen.getByLabelText(copy("connectOnboarding.countryLabel"))).toBeInTheDocument();
  await act(async () => {});
  expect(sessionCalls()).toHaveLength(0);

  fireEvent.click(screen.getByRole("button", { name: copy("connectOnboarding.countryContinue") }));
  await screen.findByTestId("connect-onboarding-fixture");
  expect(sessionCalls()).toHaveLength(1);
  expect(JSON.parse(String(sessionCalls()[0][1].body))).toEqual({ country: "US" });
});

it("sends a creator with an account straight to onboarding and shows the payout country", async () => {
  mocks.profile.mode = "data";
  mocks.profile.value = {
    uid: "teacher-1",
    stripeConnectedAccountId: "acct_teacher_1",
    stripeConnectCountry: "GB",
  };
  mount();
  await screen.findByTestId("connect-onboarding-fixture");
  expect(screen.queryByLabelText(copy("connectOnboarding.countryLabel"))).toBeNull();
  expect(JSON.parse(String(sessionCalls()[0][1].body))).toEqual({});
  expect(screen.getByText(copy("teach.earnings.payoutCountry"))).toBeInTheDocument();
  expect(screen.getByText("United Kingdom")).toBeInTheDocument();
});

// The country is permanent. A failed profile read says nothing about whether
// the creator already has an account, so it must not look like "no account".
it("shows the load error, never the country picker, when the profile read fails", async () => {
  mocks.profile.mode = "error";
  mount();
  await act(async () => {});
  expect(screen.getByRole("alert")).toHaveTextContent(copy("teach.earnings.profileError"));
  expect(screen.queryByLabelText(copy("connectOnboarding.countryLabel"))).toBeNull();
  expect(sessionCalls()).toHaveLength(0);
});
