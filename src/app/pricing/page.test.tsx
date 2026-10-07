import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PricingPage from "@/app/pricing/page";
import { publicPlans } from "@/data/plans";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    refreshUser: vi.fn(),
    status: "unauthenticated",
    user: null,
    signOut: vi.fn(),
  }),
}));

// Async server component (reads the locale via next/headers) — not renderable
// in this synchronous jsdom test and not what it asserts.
vi.mock("@/components/site/site-footer", () => ({
  SiteFooter: () => null,
}));

afterEach(() => {
  cleanup();
});

describe("pricing page", () => {
  it("says in one sentence what a plan changes, with no hint strip", async () => {
    render(await PricingPage());

    expect(
      screen.getByText(
        "Every plan publishes and sells, and each starts with 14 days free. Higher plans lower the commission and raise your limits.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Which plan is for me?")).not.toBeInTheDocument();
  });

  it("leads every card with the commission and keeps the subscription small", async () => {
    render(await PricingPage());

    const grid = within(screen.getByRole("region", { name: "Plan comparison" }));
    for (const plan of publicPlans) {
      expect(grid.getByText(`${plan.commissionPercent}%`).className).toContain(
        "text-4xl",
      );
    }
    expect(grid.getByText("$5/mo").className).not.toContain("text-4xl");
    expect(grid.getByText("$89/mo")).toBeInTheDocument();
    // Only the three plans on offer: no Free card, no Enterprise.
    expect(grid.queryByText("Free")).not.toBeInTheDocument();
    expect(grid.queryByText("Enterprise")).not.toBeInTheDocument();
    expect(grid.getAllByText("+ $0.30 per sale")).toHaveLength(3);
    expect(grid.queryByText(/no subscription/i)).not.toBeInTheDocument();
    expect(grid.getByText("Recommended").closest("article")).toHaveTextContent("Starter");
  });

  it("stretches the cards and pins the button to the bottom", async () => {
    render(await PricingPage());

    const grid = within(screen.getByRole("region", { name: "Plan comparison" }));
    const cards = grid.getAllByRole("article");
    expect(cards).toHaveLength(publicPlans.length);
    for (const card of cards) {
      expect(card.className).toContain("flex h-full flex-col");
    }
    const cta = grid.getByRole("link", { name: "Start 14-day free trial — Starter" });
    expect(cta).toHaveTextContent("Start 14-day free trial");
    expect(cta.parentElement?.className).toContain("mt-auto");
    // The renewal terms sit next to the button, for each cycle.
    expect(cta.parentElement).toHaveTextContent(
      /14 days free, then \$19\/month\. Renews automatically until you cancel\. Cancel anytime in Billing before .+ and you won't be charged\./,
    );
    expect(cta.parentElement).toHaveTextContent("14 days free, then $190/year.");
  });

  it("keeps the no-JavaScript billing toggle, in 13px sentence case", async () => {
    render(await PricingPage());

    const monthly = screen.getByLabelText("Monthly");
    expect(monthly).toBeChecked();
    expect(monthly).toHaveAttribute("type", "radio");
    const label = monthly.closest("label");
    expect(label?.className).toContain("text-[13px]");
    expect(label?.className).not.toContain("uppercase");
  });
});
