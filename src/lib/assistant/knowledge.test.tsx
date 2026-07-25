import { describe, expect, it } from "vitest";

import { helpFaqCategories } from "@/data/help-faq";
import { plans, refundWindowDays } from "@/data/plans";
import { buildAssistantKnowledge } from "@/lib/assistant/knowledge";

describe("buildAssistantKnowledge", () => {
  const knowledge = buildAssistantKnowledge();

  it("includes every plan with its price and commission", () => {
    for (const plan of plans) {
      expect(knowledge).toContain(plan.name);
      expect(knowledge).toContain(`${plan.commissionPercent}% commission`);
      if (plan.monthlyUsd > 0) {
        expect(knowledge).toContain(`$${plan.monthlyUsd}/month`);
      }
    }
  });

  it("states the refund window from plans.ts and the direct-charge payout model", () => {
    expect(knowledge).toContain(`${refundWindowDays} days from purchase`);
    // The assistant must never tell a creator we hold their money.
    expect(knowledge).toContain("never holds or remits creator money");
    expect(knowledge).toContain("charged DIRECTLY on that connected account");
    expect(knowledge).toContain("merchant of record");
    expect(knowledge).not.toContain("stay pending for");
    // "No clearing period" unqualified is false — Stripe's own settlement and
    // payout timelines still apply. Only the PLATFORM hold was deleted.
    expect(knowledge).toContain("no platform clearing period");
    expect(knowledge).not.toContain("no clearing period");
  });

  it("never promises a fast payout on the payouts line", () => {
    const payoutLine = knowledge
      .split("\n")
      .find((line) => line.startsWith("- Payouts:"));
    expect(payoutLine).toBeDefined();
    // Stripe settles on its own timeline — 30 calendar days for domestic card
    // charges in Brazil — and holds a new account's first payout. Any speed
    // claim here is a lie the advisor repeats to every creator who asks.
    for (const banned of [
      "instantly",
      "instant",
      "immediately",
      "same day",
      "same-day",
      "no waiting",
      "faster",
    ]) {
      expect(payoutLine?.toLowerCase()).not.toContain(banned);
    }
  });

  it("carries the full help FAQ verbatim", () => {
    for (const category of helpFaqCategories) {
      expect(knowledge).toContain(category.label);
      for (const item of category.items) {
        expect(knowledge).toContain(item.q);
        expect(knowledge).toContain(item.a);
      }
    }
  });

  it("stays comfortably inside a single model context", () => {
    expect(knowledge.length).toBeGreaterThan(2_000);
    expect(knowledge.length).toBeLessThan(24_000);
  });
});
