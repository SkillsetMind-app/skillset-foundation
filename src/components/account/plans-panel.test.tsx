import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlansPanel } from "@/components/account/plans-panel";
import { CONFIRM_GUARD_MS } from "@/components/ui/confirm-dialog";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

// On the Plans page the current plan was stated three times ("CURRENT PLAN / Free"
// floating as a third headline, the "Current" chip on the card and the "Your
// plan" button), and the four cards had different heights, so the
// "Upgrade" buttons did not line up.

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    status: "authenticated",
    user: {
      // Read on every render: changing the uid simulates a new billing read.
      uid: state.uid,
      email: "teacher@example.com",
      displayName: "Teacher",
      emailVerified: true,
      photoURL: null,
      roles: ["teacher"],
    },
  }),
}));

const state = vi.hoisted(() => ({
  uid: "teacher-1",
  planId: "starter" as string,
  billing: { trialEligible: true, subscription: null } as Record<string, unknown>,
  cancel: vi.fn(),
}));

vi.mock("@/lib/data/user-profiles", () => ({
  subscribeToUserProfile: vi.fn((_uid, onNext) => {
    onNext({ currentPlanId: state.planId });
    return vi.fn();
  }),
}));

vi.mock("@/lib/payments/billing", () => ({
  isCheckoutClientConfigured: () => true,
  openBillingPortal: vi.fn(),
  fetchPlanBillingState: () => Promise.resolve(state.billing),
  cancelPlanSubscription: state.cancel,
}));

// "Cancel plan" asks in a platform <dialog> (no longer in
// window.confirm). jsdom has no showModal/close: the stub does the minimum the
// browser does.
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

beforeEach(() => {
  state.uid = "teacher-1";
  state.planId = "starter";
  state.billing = { trialEligible: true, subscription: null };
  state.cancel.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value() { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value() { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new Event("close")); } });
});
afterEach(() => {
  vi.useRealTimers();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

vi.mock("@/components/account/upgrade-modal", () => ({
  UpgradeModal: () => null,
}));

describe("PlansPanel", () => {
  it.each([500, 5000, 900, 9000, 0, 350])("shows actual next payment %s separately from new offers", async (amount) => {
    state.planId = "basic";
    state.billing = { trialEligible: false, subscription: {
      planId: "basic", cycle: "monthly", status: "active", trialEnd: null,
      currentPeriodEnd: "2026-11-03T12:00:00.000Z", cancelAtPeriodEnd: false,
      nextPayment: { amountMinor: amount, currency: "usd" },
    } };
    render(<PlansPanel />);
    expect(await screen.findByText(`Next payment: $${(amount / 100).toFixed(2)}`)).toBeInTheDocument();
    expect(screen.getAllByRole("article")[0]).toHaveTextContent("$9");
  });
  it("does not describe an account without a subscription as a free plan", () => {
    state.planId = "free";
    render(<PlansPanel />);
    expect(screen.getByText("No subscription")).toBeInTheDocument();
    expect(screen.queryByText(/^Free$/)).not.toBeInTheDocument();
  });

  it("states the current plan ONCE, on one line, with no headline", () => {
    render(<PlansPanel />);

    // The "Current plan: Starter" line exists...
    expect(screen.getByText("Current plan:")).toBeInTheDocument();
    // ...and there is no longer the big headline or the disabled "Your plan" button.
    expect(
      screen.queryByRole("heading", { name: /^Starter$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Your plan" }),
    ).not.toBeInTheDocument();
    // The card marks the plan with the chip, and that is all.
    expect(screen.getByText("Your plan tier")).toBeInTheDocument();
  });

  it("aligns the buttons: card as a flex column, action pushed to the bottom", () => {
    render(<PlansPanel />);

    const cards = screen.getAllByRole("article");
    expect(cards.length).toBeGreaterThanOrEqual(2);
    for (const card of cards) {
      expect(card.className).toMatch(/\bflex\b/);
      expect(card.className).toMatch(/\bflex-col\b/);
      expect(card.className).toMatch(/\bh-full\b/);
      expect(card.querySelector(".mt-auto")).not.toBeNull();
    }
  });

  it("shows the Monthly/Annual selector at 13px with no uppercase, on the title line", () => {
    render(<PlansPanel />);

    // The app's segmented selector (PeriodTabs): the choice goes on the
    // button itself (aria-pressed) and the size comes from the .studio-range-tabs rule.
    const monthly = screen.getByRole("button", { name: "Monthly" });
    expect(monthly).toHaveAttribute("aria-pressed", "true");
    expect(monthly.closest(".studio-range-tabs")).not.toBeNull();
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const start = css.indexOf(".studio-range-tabs button {");
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toMatch(/font-size: 0\.8125rem;/);
    expect(rule).not.toMatch(/uppercase/);
  });
});

describe("PlansPanel with the 2 plans and the free trial", () => {
  it.each([
    [500, "monthly", false], [5000, "yearly", false],
    [500, "monthly", true], [5000, "yearly", true],
  ])("separates legacy tariff %s/%s from current offers (cancelled %s)", async (amount, cycle, cancelled) => {
    state.planId = "basic";
    state.billing = { trialEligible: false, subscription: {
      planId: "basic", cycle, status: "active", trialEnd: null,
      currentPeriodEnd: "2026-11-03T12:00:00.000Z", cancelAtPeriodEnd: cancelled,
      contractedPrice: { amountMinor: amount, currency: "usd", cycle }, nextPayment: null,
    } };
    render(<PlansPanel />);
    expect(await screen.findByText(`Subscription price before discounts and tax: $${(Number(amount) / 100).toFixed(2)}/${cycle === "yearly" ? "year" : "month"}`)).toBeInTheDocument();
    const card = screen.getAllByRole("article")[0];
    expect(card).toHaveTextContent("Current offer for new subscriptions.");
    expect(within(card).queryByText("Current")).not.toBeInTheDocument();
    expect(within(card).queryByText("Your plan")).not.toBeInTheDocument();
    if (cancelled) expect(screen.queryByText(/^Next payment:/)).not.toBeInTheDocument();
    else expect(screen.getByText(/^Next payment:/)).not.toHaveTextContent("$9");
    fireEvent.click(screen.getByRole("button", { name: /^Yearly/ }));
    expect(card).toHaveTextContent("$90");
  });
  it("shows only Basic, Starter and Pro, even for people who still have no plan", () => {
    state.planId = "free";
    render(<PlansPanel />);

    const names = screen.getAllByRole("article").map((card) => card.querySelector("p")?.textContent);
    expect(names).toEqual(["Basic", "Starter", "Pro"]);
    expect(screen.queryByText("Enterprise")).not.toBeInTheDocument();
  });

  it("offers the 14-day trial with the renewal terms next to the button", async () => {
    state.planId = "free";
    render(<PlansPanel />);

    const pro = screen.getAllByRole("article")[2];
    const cta = await within(pro).findByRole("button", { name: "Start your 14-day free trial" });
    expect(cta.parentElement).toHaveTextContent(
      /14-day free trial, then \$89\/month\. Renews automatically until you cancel\. Cancel anytime in Billing before .+ and you won't be charged\./,
    );

    // The annual discount is on the button itself, not in an invisible title.
    const yearly = screen.getByRole("button", { name: /^Yearly/ });
    expect(yearly).toHaveTextContent("~17% off");
    expect(yearly).not.toHaveAttribute("title");
    fireEvent.click(yearly);
    expect(pro).toHaveTextContent("14-day free trial, then $890/year.");
  });

  it("after the trial is used, the button goes back to Upgrade and the terms do not promise a trial", async () => {
    state.planId = "free";
    state.billing = { trialEligible: false, subscription: null };
    render(<PlansPanel />);

    const pro = screen.getAllByRole("article")[2];
    expect(await within(pro).findByRole("button", { name: "Upgrade to Pro" })).toBeInTheDocument();
    expect(pro).toHaveTextContent("$89/month, starting today. Renews automatically until you cancel.");
    expect(pro).not.toHaveTextContent("free trial");
  });

  it("during the trial it shows when it ends and a Cancel plan that works", async () => {
    state.planId = "pro";
    state.billing = {
      trialEligible: false,
      subscription: {
        planId: "pro",
        cycle: "monthly",
        status: "trialing",
        trialEnd: "2026-10-20T12:00:00.000Z",
        currentPeriodEnd: "2026-10-20T12:00:00.000Z",
        cancelAtPeriodEnd: false,
      },
    };
    state.cancel.mockResolvedValue({ ...(state.billing.subscription as object), cancelAtPeriodEnd: true });
    // Only Date is fake: confirm ignores clicks in the first 500ms.
    vi.useFakeTimers({ toFake: ["Date"] });
    render(<PlansPanel />);

    expect(await screen.findByText("Free trial — ends October 20, 2026")).toBeInTheDocument();
    // A real button, in the danger red, and not a gold link.
    const trigger = screen.getByRole("button", { name: "Cancel plan" });
    expect(trigger).toHaveClass("button-danger");
    fireEvent.click(trigger);

    // (a) the usual sentence, now inside the platform dialog;
    const dialog = screen.getByRole("dialog", { name: "Cancel plan" });
    expect(dialog).toHaveTextContent(
      "Cancel your plan? Your free trial runs until October 20, 2026 and you won't be charged.",
    );
    // (b) opening the question cancels nothing;
    expect(state.cancel).not.toHaveBeenCalled();
    // (c) confirming calls the cancel once. A click right on the
    // opening (double tap) is discarded.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel plan" }));
    expect(state.cancel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel plan" }));
    expect(await screen.findByText("Ends on October 20, 2026")).toBeInTheDocument();
    expect(state.cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Cancel plan" })).not.toBeInTheDocument();
  });

  it.each([
    ["past_due", "Cancel your plan now? The unpaid invoice won't be retried and the plan ends immediately."],
    ["unpaid", "Cancel your plan now? The unpaid invoice won't be retried and the plan ends immediately."],
    ["active", "Cancel your plan? It stays active until November 3, 2026 and won't renew."],
  ])("the Cancel plan of a %s subscription shows the right notice", async (status, prompt) => {
    state.planId = "pro";
    state.billing = {
      trialEligible: false,
      subscription: {
        planId: "pro",
        cycle: "monthly",
        status,
        trialEnd: null,
        currentPeriodEnd: "2026-11-03T12:00:00.000Z",
        cancelAtPeriodEnd: false,
      },
    };
    state.cancel.mockResolvedValue({ ...(state.billing.subscription as object), cancelAtPeriodEnd: true });
    const nativeConfirm = vi.spyOn(window, "confirm");
    render(<PlansPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel plan" }));
    expect(screen.getByRole("dialog", { name: "Cancel plan" })).toHaveTextContent(prompt);
    expect(nativeConfirm).not.toHaveBeenCalled();
    // Giving up ("Keep plan") closes without sending the request.
    fireEvent.click(screen.getByRole("button", { name: "Keep plan" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state.cancel).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it("canceling now (past_due) closes the dialog and it does not come back by itself later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    state.planId = "pro";
    const pastDue = {
      planId: "pro",
      cycle: "monthly",
      status: "past_due",
      trialEnd: null,
      currentPeriodEnd: "2026-11-03T12:00:00.000Z",
      cancelAtPeriodEnd: false,
    };
    state.billing = { trialEligible: false, subscription: pastDue };
    // The route ends right away and returns subscription: null — the dialog disappears without
    // going through onClose.
    state.cancel.mockResolvedValue(null);
    const { rerender } = render(<PlansPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel plan" }));
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel plan" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(state.cancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Cancel plan" })).not.toBeInTheDocument();

    // A subscription shows up again on a new read: the question does not open
    // by itself, and the button opens it again, clean.
    state.uid = "teacher-2";
    state.billing = { trialEligible: false, subscription: { ...pastDue, status: "active" } };
    rerender(<PlansPanel />);
    const trigger = await screen.findByRole("button", { name: "Cancel plan" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Cancel plan" })).toHaveTextContent(
      "Cancel your plan? It stays active until November 3, 2026 and won't renew.",
    );
    expect(state.cancel).toHaveBeenCalledOnce();
  });

  it("an Enterprise (ex-Plus) subscriber sees their own plan, with no Enterprise card for sale", () => {
    state.planId = "plus";
    render(<PlansPanel />);

    expect(screen.getByText("Current plan:").parentElement).toHaveTextContent("Enterprise");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
  });
});

describe("the Plans page", () => {
  it("opens on the cards: the opening card with the second headline is gone", () => {
    const page = readFileSync(
      path.join(process.cwd(), "src/app/account/plans/page.tsx"),
      "utf8",
    );

    // The whole sentence is what the JSX rendered; the comment that explains the
    // removal quotes only the beginning of it.
    expect(page).not.toContain("Choose the plan that fits your course business.");
    expect(page).not.toContain("platform-hero-card");
  });
});

describe("PlansPanel - plan that does not load", () => {
  const defaultProfile = vi.mocked(subscribeToUserProfile).getMockImplementation()!;
  afterEach(() => {
    vi.mocked(subscribeToUserProfile).mockImplementation(defaultProfile);
  });

  it("gets \"Try again\", which reads the profile again once and shows the plan", async () => {
    let failing = true;
    const reload = vi.fn();
    vi.mocked(subscribeToUserProfile).mockImplementation((_uid, onNext, onError) => {
      if (failing) onError(new Error("offline"));
      else onNext({ currentPlanId: "starter" } as never);
      return Object.assign(vi.fn(), {
        reload: async () => {
          reload();
          failing = false;
          onNext({ currentPlanId: "starter" } as never);
        },
      });
    });
    render(<PlansPanel />);
    expect(await screen.findByText(/We could not read your plan\./)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByText(/We could not read your plan\./)).toBeNull());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("cancel error does not get \"Try again\"", async () => {
    state.planId = "pro";
    state.billing = {
      trialEligible: false,
      subscription: {
        planId: "pro", cycle: "monthly", status: "active", trialEnd: null,
        currentPeriodEnd: "2026-11-03T12:00:00.000Z", cancelAtPeriodEnd: false,
      },
    };
    state.cancel.mockRejectedValue(new Error("boom"));
    vi.useFakeTimers({ toFake: ["Date"] });
    render(<PlansPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel plan" }));
    vi.advanceTimersByTime(CONFIRM_GUARD_MS);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Cancel plan" })).getByRole("button", { name: "Cancel plan" }));
    expect(await screen.findByText("We couldn't cancel the plan. Try again, or use Manage subscription.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
