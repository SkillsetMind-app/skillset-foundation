import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { isConnectNotEnabledError } from "@/lib/payments/connect-self-heal";

function invalidRequest(message: string, statusCode = 400) {
  return new Stripe.errors.StripeInvalidRequestError({
    message,
    statusCode,
    type: "invalid_request_error",
  });
}

describe("isConnectNotEnabledError", () => {
  it("classifies Stripe's incomplete platform profile response", () => {
    expect(
      isConnectNotEnabledError(
        invalidRequest(
          "You must complete your platform profile to use Connect and create live connected accounts.",
        ),
      ),
    ).toBe(true);
  });

  it("does not downgrade unrelated invalid requests", () => {
    expect(isConnectNotEnabledError(invalidRequest("Invalid country."))).toBe(false);
  });

  it("does not downgrade a server failure that repeats setup wording", () => {
    expect(
      isConnectNotEnabledError(
        invalidRequest("Complete your platform profile to use Connect.", 500),
      ),
    ).toBe(false);
  });
});
