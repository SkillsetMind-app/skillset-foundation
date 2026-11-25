import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { PlatformNav } from "@/components/platform/platform-nav";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";

// The earnings page asked for three paragraphs before the first number, put the
// fourth tile alone on a row and — for someone who is also an admin — opened with the
// /ops bar, which has no Earnings item: the bar hid the very screen
// the person was on. (The language of the Stripe widget has its own file:
// earnings-stripe-locale.test.tsx.)

// STABLE references on purpose: the panel subscribes to profile and ledger with
// `[user]` in the dependencies and keeps the result in state. Returning a new object
// on every render redoes the effect, which changes the state, which renders again — a
// synchronous loop inside React's act() that not even testTimeout interrupts.
const mocks = vi.hoisted(() => ({
  pathname: "/account/payments",
  user: {
    uid: "teacher-1",
    email: "teacher@example.com",
    displayName: "Teacher",
    emailVerified: true,
    photoURL: null,
    roles: ["admin"] as string[],
  },
  profile: {} as Record<string, unknown>,
  ledger: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (
    _uid: string,
    onData: (profile: Record<string, unknown>) => void,
  ) => {
    onData(mocks.profile);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (
    _uid: string,
    onData: (entries: unknown[]) => void,
  ) => {
    onData(mocks.ledger);
    return () => undefined;
  },
}));

vi.mock("@/lib/data/creator-verification", () => ({
  fetchCreatorActivationBlocked: () => Promise.resolve(false),
}));

vi.mock("@/lib/payments/connect", () => ({
  isConnectNotEnabledError: () => false,
  refreshTeacherStripeAccountStatus: () =>
    Promise.resolve({ chargesEnabled: false, payoutsEnabled: false }),
}));

// Stripe's embedded onboarding has its own asynchronous initialization and has
// nothing to do with the sentence, the tiles or the bar.
vi.mock("@/components/teacher/teacher-connect-onboarding", () => ({
  TeacherConnectOnboarding: () => <div data-testid="stripe-onboarding" />,
}));

afterEach(() => {
  cleanup();
  mocks.pathname = "/account/payments";
  mocks.user.roles = ["admin"];
});

// The root layout mounts the I18nProvider; the interface language comes from it.
function renderInApp(ui: React.ReactNode) {
  return render(<I18nProvider initialLocale="en">{ui}</I18nProvider>);
}

describe("earnings: one sentence, four columns and the right bar", () => {
  it("shows ONE sentence and keeps the long text hidden until 'Learn more' is opened", () => {
    renderInApp(<TeacherWalletPanel />);

    // The sentence that answers "whose money is this" is visible.
    expect(screen.getByText(en.teach.earnings.intro)).toBeVisible();

    // The long paragraph exists, but only for whoever asks for it.
    const longText = screen.getByText(en.teach.earnings.details);
    expect(longText).not.toBeVisible();

    const disclosure = longText.closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure!.querySelector("summary")?.textContent).toBe(
      en.teach.earnings.learnMore,
    );

    disclosure!.open = true;
    expect(longText).toBeVisible();
  });

  it("puts the four tiles in a four-column grid, with no orphan", () => {
    renderInApp(<TeacherWalletPanel />);

    const labels = [
      "Paid sales",
      "Gross sales",
      "Platform fee est.",
      "Stripe fee est.",
    ];
    for (const label of labels) {
      expect(screen.getByText(label)).toBeVisible();
    }

    const grid = screen.getByText("Paid sales").closest("div.grid");
    expect(grid).not.toBeNull();
    // Four tiles in three columns left the last one alone on the second row.
    expect(grid!.className).not.toContain("md:grid-cols-3");
    expect(grid!.className).toContain("xl:grid-cols-4");
    expect(grid!.querySelectorAll("article")).toHaveLength(4);
  });

  it("keeps the Teach bar on /account/payments for someone who is also an admin", () => {
    renderInApp(<PlatformNav />);

    // The item of the very page the person is on.
    expect(
      screen.getByRole("link", { name: en.platform.nav.earnings }),
    ).toHaveAttribute("href", "/account/payments");
  });

  it("the Spanish dictionary has the same new keys", () => {
    for (const key of Object.keys(en.teach.earnings)) {
      const value = (es.teach.earnings as Record<string, string>)[key];
      expect(value, `es.teach.earnings.${key}`).toBeTruthy();
      expect(value).not.toBe((en.teach.earnings as Record<string, string>)[key]);
    }
  });
});
vi.mock("@/lib/data/creator-plan", () => ({ fetchCreatorPlanRequired: async () => false }));
