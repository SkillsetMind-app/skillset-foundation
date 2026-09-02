import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PricingPage from "@/app/pricing/page";
import { plans } from "@/data/plans";

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
  it("says in one sentence what a plan changes, with no hint strip", () => {
    render(<PricingPage />);

    expect(
      screen.getByText(
        "Every plan can sell. Paid plans lower the commission and raise your limits.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Which plan is for me?")).not.toBeInTheDocument();
  });

  it("leads every card with the commission and keeps the subscription small", () => {
    render(<PricingPage />);

    const grid = within(screen.getByRole("region", { name: "Plan comparison" }));
    for (const plan of plans) {
      expect(grid.getByText(`${plan.commissionPercent}%`).className).toContain(
        "text-4xl",
      );
    }
    expect(grid.getByText("$0/mo — no subscription").className).not.toContain(
      "text-4xl",
    );
    expect(grid.getByText("$19/mo")).toBeInTheDocument();
  });

  it("stretches the cards and pins the button to the bottom", () => {
    render(<PricingPage />);

    const grid = within(screen.getByRole("region", { name: "Plan comparison" }));
    const cards = grid.getAllByRole("article");
    expect(cards).toHaveLength(plans.length);
    for (const card of cards) {
      expect(card.className).toContain("flex h-full flex-col");
    }
    expect(grid.getByRole("link", { name: "Start on Free" }).className).toContain(
      "mt-auto",
    );
  });

  it("keeps the no-JavaScript billing toggle, in 13px sentence case", () => {
    render(<PricingPage />);

    const monthly = screen.getByLabelText("Monthly");
    expect(monthly).toBeChecked();
    expect(monthly).toHaveAttribute("type", "radio");
    const label = monthly.closest("label");
    expect(label?.className).toContain("text-[13px]");
    expect(label?.className).not.toContain("uppercase");
  });
});
