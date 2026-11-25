import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import type { PayoutLedgerEntry } from "@/domain/payout-ledger";

// What the new teacher saw in Earnings: the account block empty until the
// form dropped in, the statement as one sentence inside a box, "Order {uuid}" and
// "Payment pi_..." on every row, and a read failure with no way out (only reloading
// the page), said twice. The help "?" lived inside the h1.

// STABLE references: the panel subscribes to profile and ledger with `[user]`.
const mocks = vi.hoisted(() => ({
  user: { uid: "teacher-1" },
  profile: { mode: "data" as "pending" | "data" | "error", value: {} as Record<string, unknown> },
  ledger: { mode: "data" as "pending" | "data" | "error", value: [] as PayoutLedgerEntry[] },
  onProfile: null as null | ((profile: Record<string, unknown>) => void),
  onLedger: null as null | ((entries: PayoutLedgerEntry[]) => void),
  reloadProfile: vi.fn(),
  reloadLedger: vi.fn(),
  inbox: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ status: "authenticated", user: mocks.user }),
}));
vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: (
    _uid: string,
    onData: (profile: Record<string, unknown>) => void,
    onError: (error: Error) => void,
  ) => {
    mocks.onProfile = onData;
    if (mocks.profile.mode === "data") onData(mocks.profile.value);
    if (mocks.profile.mode === "error") onError(new Error("profile read failed"));
    return Object.assign(() => undefined, { reload: mocks.reloadProfile });
  },
}));
vi.mock("@/lib/data/payout-ledger", () => ({
  subscribeToTeacherPayoutLedger: (
    _uid: string,
    onData: (entries: PayoutLedgerEntry[]) => void,
    onError: (error: Error) => void,
  ) => {
    mocks.onLedger = onData;
    if (mocks.ledger.mode === "data") onData(mocks.ledger.value);
    if (mocks.ledger.mode === "error") onError(new Error("ledger read failed"));
    return Object.assign(() => undefined, { reload: mocks.reloadLedger });
  },
}));
vi.mock("@/components/teacher/use-teacher-inbox-count", () => ({ loadTeacherInbox: mocks.inbox }));
vi.mock("@/lib/payments/connect", () => ({
  isConnectNotEnabledError: () => false,
  refreshTeacherStripeAccountStatus: mocks.refresh,
}));
vi.mock("@/components/teacher/teacher-connect-onboarding", () => ({
  TeacherConnectOnboarding: () => <div data-testid="stripe-onboarding" />,
}));

const entry: PayoutLedgerEntry = {
  id: "l1",
  teacherId: "teacher-1",
  courseId: "course-1",
  orderId: "3f8e2b6c-41d7-4a9e-9c55-2b1e7d0a6f13",
  paymentId: "pi_3QxYz8Lk2mN4aB7c",
  grossAmountMinor: 4900,
  skillsetFeeMinor: 490,
  stripeFeeMinor: 172,
  netAmountMinor: 4238,
  currency: "USD",
  status: "settled",
  createdAt: "2026-11-18T12:00:00.000Z",
};

function mount(locale: "en" | "es" = "en") {
  return render(<I18nProvider initialLocale={locale}><TeacherWalletPanel /></I18nProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile.mode = "data";
  mocks.profile.value = {};
  mocks.ledger.mode = "data";
  mocks.ledger.value = [];
  mocks.inbox.mockResolvedValue({ courses: [], questions: [], threads: 0 });
  mocks.refresh.mockResolvedValue({ chargesEnabled: false, payoutsEnabled: false });
  mocks.reloadProfile.mockResolvedValue(undefined);
  mocks.reloadLedger.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("earnings: header of the sibling screens", () => {
  it.each(["en", "es"] as const)("the h1 is just the title, with no period, and the '?' sits beside it (%s)", async (locale) => {
    mount(locale);
    await act(async () => {});
    const title = locale === "en" ? "Your earnings, your payout setup" : "Tus ganancias, tu configuración de pagos";
    // Exact name: with the button inside, the h1's name carried "Help about ...".
    const heading = screen.getByRole("heading", { level: 1, name: title });
    expect(within(heading).queryByRole("button")).toBeNull();
    const help = screen.getByRole("button", {
      name: locale === "en" ? "Help about Payout schedule" : "Ayuda sobre Calendario de pagos",
    });
    expect(heading.parentElement).toContainElement(help);
    // The "Earnings" label on top only repeated the name of the bar.
    expect(screen.queryByText(locale === "en" ? "Earnings" : "Ganancias", { selector: "p" })).toBeNull();
  });
});

describe("earnings: payments account block", () => {
  it("while the profile arrives, the block has the shape of the first step, with no form", async () => {
    mocks.profile.mode = "pending";
    mount();
    await act(async () => {});
    const connect = document.getElementById("stripe-connect")!;
    const skeleton = connect.querySelector("[data-skeleton=connect]")!;
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton.querySelectorAll(".animate-pulse").length).toBeGreaterThan(2);
    expect(within(connect).queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("stripe-onboarding")).toBeNull();
  });

  // The account block and the statement wait together on the first visit: they were two
  // notices speaking at the same time. Just one, from the page, and it goes quiet when it arrives.
  it("on the first visit there is a single waiting notice, and it goes quiet when everything arrives", async () => {
    mocks.profile.mode = "pending";
    mocks.ledger.mode = "pending";
    mount();
    await act(async () => {});
    const waiting = screen.getAllByRole("status");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toHaveTextContent("Loading your earnings and payout account...");

    await act(async () => {
      mocks.onProfile?.({});
      mocks.onLedger?.([]);
    });
    expect(screen.getAllByRole("status")).toEqual(waiting);
    expect(waiting[0]).toHaveTextContent(/^$/);
  });

  it("the login renewal (another object, same id) does not re-read the products", async () => {
    const view = mount();
    await act(async () => {});
    expect(mocks.inbox).toHaveBeenCalledTimes(1);
    const user = mocks.user;
    mocks.user = { uid: user.uid };
    try {
      view.rerender(<I18nProvider initialLocale="en"><TeacherWalletPanel /></I18nProvider>);
      await act(async () => {});
      expect(mocks.inbox).toHaveBeenCalledTimes(1);
    } finally {
      mocks.user = user;
    }
  });

  it("profile that fails: a single notice, in the block, with Try again that reads again", async () => {
    mocks.profile.mode = "error";
    mount();
    await act(async () => {});
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("We could not load your payout profile.");
    expect(document.getElementById("stripe-connect")).toContainElement(alerts[0]);
    // Without a profile there is no way to know if there is an account: the badge does not say "Not connected".
    expect(screen.queryByText("Not connected")).toBeNull();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("stripe-onboarding")).toBeNull();

    // "Try again" only re-reads the profile: it does not call Stripe.
    const stripeCalls = mocks.refresh.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.reloadProfile).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(stripeCalls);
    await act(async () => {
      mocks.onProfile?.({});
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("stripe-onboarding")).toBeInTheDocument();
  });

  it("a failure to refresh the account is the house error notice; success is the status one", async () => {
    mount();
    // The silent check of the visit has already passed; from here on, the click.
    await act(async () => {});
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    mocks.refresh.mockRejectedValueOnce(new Error(""));
    fireEvent.click(screen.getByRole("button", { name: "Refresh account status" }));
    await act(async () => {});
    expect(screen.getByRole("alert")).toHaveTextContent("We could not refresh Stripe payout status.");

    mocks.refresh.mockResolvedValueOnce({ chargesEnabled: true, payoutsEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: "Refresh account status" }));
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Stripe charges and payouts are ready for this teacher account.").closest("[role=status]"))
      .not.toBeNull();
  });
});

describe("earnings: statement", () => {
  it("while the ledger arrives, rows in the statement format, not a sentence", async () => {
    mocks.ledger.mode = "pending";
    mount();
    await act(async () => {});
    const statements = screen.getByRole("heading", { level: 2, name: "Recent earnings record." }).closest("section")!;
    const skeleton = statements.querySelector("[data-skeleton=statement]")!;
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton.children).toHaveLength(3);
    expect(within(statements).queryByRole("status")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading your earnings and payout account...");
  });

  it("each row says the product and the short order code, without the payment id", async () => {
    mocks.ledger.value = [entry];
    mocks.inbox.mockResolvedValue({ courses: [{ id: "course-1", title: "Stress Reset Program", communityEnabled: false }], questions: [], threads: 0 });
    mount();
    await act(async () => {});
    const row = screen.getByRole("link", { name: /Stress Reset Program/ });
    expect(row).toHaveAttribute("href", `/teach/sales/${entry.orderId}`);
    expect(within(row).getByText("Order #7D0A6F13")).toBeInTheDocument();
    expect(row).not.toHaveTextContent(entry.orderId);
    expect(row).not.toHaveTextContent("pi_3QxYz8Lk2mN4aB7c");
  });

  it("with no product name, the row keeps the short code, as in Sales", async () => {
    mocks.ledger.value = [entry];
    mocks.inbox.mockRejectedValue(new Error("inbox read failed"));
    mount("es");
    await act(async () => {});
    const row = screen.getByRole("link", { name: /Pedido #7D0A6F13/ });
    expect(row).not.toHaveTextContent("pi_3QxYz8Lk2mN4aB7c");
  });

  it("ledger read that fails: a single notice, in the statement, with Try again; the numbers say Unavailable", async () => {
    mocks.ledger.mode = "error";
    mount();
    await act(async () => {});
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("We could not load your earnings record.");
    const statements = screen.getByRole("heading", { level: 2, name: "Recent earnings record." }).closest("section")!;
    expect(statements).toContainElement(alerts[0]);
    expect(screen.queryByText("$0.00")).toBeNull();

    const stripeCalls = mocks.refresh.mock.calls.length;
    fireEvent.click(within(statements).getByRole("button", { name: "Try again" }));
    expect(mocks.reloadLedger).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(stripeCalls);
    await act(async () => {
      mocks.onLedger?.([entry]);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: /Order #7D0A6F13/ })).toBeInTheDocument();
  });
});
