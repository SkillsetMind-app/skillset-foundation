import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PricingPage from "@/app/pricing/page";
import { publicPlans } from "@/data/plans";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

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
        "Every plan publishes and sells, and each starts with a 14-day free trial, card required. Higher plans lower the commission, down to 0% on Pro, and raise your limits.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Which plan is for me?")).not.toBeInTheDocument();
  });

  // Enterprise is not a card; it is one line under them that goes to /contact
  // with the subject already filled in.
  it("offers Enterprise as a contact line below the plan cards", async () => {
    render(await PricingPage());

    expect(screen.getByRole("region", { name: "Plan comparison" }).querySelectorAll("article")).toHaveLength(3);
    expect(
      screen.getByRole("link", { name: "Selling more than US$10,000/month? Talk to us about Enterprise" }),
    ).toHaveAttribute("href", "/contact?subject=enterprise");
    expect(translate(getDictionary("es"), "publicPages.pricing.enterprise_talk_to_us")).toBe(
      "¿Vendes más de US$10.000 al mes? Habla con nosotros sobre Enterprise",
    );
  });

  it("leads every card with the dollar price and keeps the commission small", async () => {
    render(await PricingPage());

    const grid = within(screen.getByRole("region", { name: "Plan comparison" }));
    for (const plan of publicPlans) {
      expect(grid.getByText(`$${plan.monthlyUsd}`).className).toContain("text-4xl");
      expect(grid.getByText(`${plan.commissionPercent}%`).className).not.toContain("text-4xl");
    }
    expect(grid.getByText("$89")).toBeInTheDocument();
    // Only the three plans on offer: no Free card, no Enterprise.
    expect(grid.queryByText("Free")).not.toBeInTheDocument();
    expect(grid.queryByText("Enterprise")).not.toBeInTheDocument();
    // Pro is 0%: no fixed part, and the Stripe caveat instead.
    expect(grid.getAllByText("+ $0.30 per sale")).toHaveLength(2);
    expect(grid.getByText("commission. Card processing by Stripe still applies.").closest("article")).toHaveTextContent("Pro");
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
    // One link per cycle; CSS shows the one for the selected cycle.
    const [cta, yearlyCta] = grid.getAllByRole("link", { name: "Start your 14-day free trial — Starter" });
    expect(cta).toHaveTextContent("Start your 14-day free trial");
    expect(yearlyCta.parentElement).toBe(cta.parentElement);
    expect(cta.parentElement?.className).toContain("mt-auto");
    // The renewal terms sit next to the button, for each cycle.
    expect(cta.parentElement).toHaveTextContent(
      "14-day free trial, then $19/month. A card is required. Renews automatically until you cancel. Cancel in Billing before your trial ends to avoid the subscription charge.",
    );
    expect(cta.parentElement).toHaveTextContent("14-day free trial, then $190/year.");
  });

  // The plan used to be lost on the way to signup: all three buttons went to
  // the same /auth link and the teacher had to pick the plan again after
  // onboarding. Each button now says which plan and which cycle.
  it("sends each plan button to signup with its plan and the selected cycle", async () => {
    render(await PricingPage());

    const grid = within(screen.getByRole("region", { name: "Plan comparison" }));
    expect(publicPlans.map((plan) => plan.id)).toEqual(["basic", "starter", "pro"]);
    for (const plan of publicPlans) {
      const links = grid.getAllByRole("link", { name: `Start your 14-day free trial — ${plan.name}` });
      expect(links.map((link) => link.getAttribute("href"))).toEqual([
        `/auth?mode=signup&path=teacher&plan=${plan.id}&cycle=monthly`,
        `/auth?mode=signup&path=teacher&plan=${plan.id}&cycle=yearly`,
      ]);
      // Same toggle as the prices: exactly one of the two is displayed.
      const [monthly, yearly] = links.map((link) => link.className.split(" "));
      expect(monthly).toContain("group-has-[#billing-yearly:checked]:hidden");
      expect(monthly).not.toContain("hidden");
      expect(yearly).toContain("hidden");
      expect(yearly).toContain("group-has-[#billing-yearly:checked]:inline-flex");
    }
    // The closing button names no plan and stays as it was.
    const closing = screen.getByText("Ready to publish on SkillsetMind?").closest("section")!;
    expect(within(closing).getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      "/auth?mode=signup&path=teacher",
    );
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

  // Num celular de 360px a coluna da resposta ficava toda fora da caixa.
  it("keeps the fee table's last column, You receive, pinned while the table scrolls", async () => {
    render(await PricingPage());

    const table = screen.getByRole("table");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.at(-1)).toHaveTextContent("You receive");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(publicPlans.length + 1);
    for (const row of rows) {
      const last = within(row).queryAllByRole("cell").at(-1) ?? within(row).getAllByRole("columnheader").at(-1);
      expect(last).toHaveClass("sticky", "right-0", "sm:shadow-none");
    }
  });
});
