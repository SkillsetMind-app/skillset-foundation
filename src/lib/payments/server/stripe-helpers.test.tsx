import { describe, expect, it, vi } from "vitest";

import { ensureCourseSubscriptionCanceled } from "@/lib/payments/server/stripe-helpers";

describe("ensureCourseSubscriptionCanceled", () => {
  it("cancels an active subscription", async () => {
    const retrieve = vi.fn().mockResolvedValue({ status: "active" });
    const cancel = vi.fn().mockResolvedValue({ status: "canceled" });

    await ensureCourseSubscriptionCanceled(
      { subscriptions: { retrieve, cancel } },
      "sub_123",
    );

    expect(retrieve).toHaveBeenCalledWith("sub_123");
    expect(cancel).toHaveBeenCalledWith("sub_123");
  });

  it("does not cancel twice when a refund request is retried", async () => {
    const retrieve = vi.fn().mockResolvedValue({ status: "canceled" });
    const cancel = vi.fn();

    await ensureCourseSubscriptionCanceled(
      { subscriptions: { retrieve, cancel } },
      "sub_123",
    );

    expect(cancel).not.toHaveBeenCalled();
  });
});
