import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

import {
  isOrphanedAccountError,
  runWithOrphanedAccountSelfHeal,
} from "./stripe-connect-self-heal";

/**
 * Builds a realistic Stripe API error the way stripe-node does internally
 * (StripeError.generate dispatches to the right subclass from `type`), so the
 * `instanceof` gates in isOrphanedAccountError exercise the real class graph.
 */
function stripeApiError(params: {
  type: string;
  code?: string;
  statusCode?: number;
  message?: string;
  decline_code?: string;
}): Stripe.errors.StripeError {
  return Stripe.errors.StripeError.generate({
    type: params.type,
    code: params.code,
    statusCode: params.statusCode,
    message: params.message ?? "stripe error",
    decline_code: params.decline_code,
  } as never);
}

describe("isOrphanedAccountError — accepts only genuine orphaned-account errors", () => {
  it("accepts StripeInvalidRequestError with code account_invalid", () => {
    const error = stripeApiError({
      type: "invalid_request_error",
      code: "account_invalid",
      statusCode: 400,
      message:
        "You requested an account link for an account that is not connected to your platform or does not exist.",
    });
    expect(error).toBeInstanceOf(Stripe.errors.StripeInvalidRequestError);
    expect(isOrphanedAccountError(error)).toBe(true);
  });

  it("accepts StripeInvalidRequestError with code resource_missing", () => {
    const error = stripeApiError({
      type: "invalid_request_error",
      code: "resource_missing",
      statusCode: 404,
      message: "No such account: 'acct_123'",
    });
    expect(isOrphanedAccountError(error)).toBe(true);
  });

  it("accepts a code-less invalid_request_error via the orphan message regex", () => {
    const error = stripeApiError({
      type: "invalid_request_error",
      statusCode: 400,
      message: "The account is not connected to your platform or does not exist.",
    });
    expect(error.code).toBeUndefined();
    expect(isOrphanedAccountError(error)).toBe(true);
  });
});

describe("isOrphanedAccountError — rejects everything that is NOT a clear orphan", () => {
  it("rejects transient connection errors (a valid account must not be discarded)", () => {
    expect(
      isOrphanedAccountError(
        new Stripe.errors.StripeConnectionError({ message: "connection reset" }),
      ),
    ).toBe(false);
  });

  it("rejects rate-limit (429)", () => {
    expect(
      isOrphanedAccountError(
        new Stripe.errors.StripeRateLimitError({
          message: "too many requests",
          statusCode: 429,
        } as never),
      ),
    ).toBe(false);
  });

  it("rejects authentication errors (401) — the key is the problem, not the account", () => {
    expect(
      isOrphanedAccountError(
        new Stripe.errors.StripeAuthenticationError({
          message: "Invalid API Key provided",
          statusCode: 401,
        } as never),
      ),
    ).toBe(false);
  });

  it("rejects Stripe-side API errors (500)", () => {
    expect(
      isOrphanedAccountError(
        new Stripe.errors.StripeAPIError({
          message: "server error",
          statusCode: 500,
        } as never),
      ),
    ).toBe(false);
  });

  it("rejects permission errors (403) — revocation is not an orphan; recreating cannot fix it", () => {
    expect(
      isOrphanedAccountError(
        new Stripe.errors.StripePermissionError({
          message: "does not have access to account acct_123",
          statusCode: 403,
        } as never),
      ),
    ).toBe(false);
  });

  it("rejects a card decline even though it carries a code", () => {
    const error = stripeApiError({
      type: "card_error",
      code: "card_declined",
      decline_code: "insufficient_funds",
      statusCode: 402,
      message: "Your card was declined.",
    });
    expect(error).toBeInstanceOf(Stripe.errors.StripeCardError);
    expect(isOrphanedAccountError(error)).toBe(false);
  });

  it("rejects an unrelated invalid_request_error (e.g. a bad param, no orphan code/message)", () => {
    const error = stripeApiError({
      type: "invalid_request_error",
      code: "parameter_invalid_empty",
      statusCode: 400,
      message: "You passed an empty string for 'refresh_url'.",
    });
    expect(isOrphanedAccountError(error)).toBe(false);
  });

  it("rejects non-Stripe errors and nullish values", () => {
    expect(isOrphanedAccountError(new Error("boom"))).toBe(false);
    expect(isOrphanedAccountError(undefined)).toBe(false);
    expect(isOrphanedAccountError(null)).toBe(false);
    expect(isOrphanedAccountError("not connected to your platform")).toBe(false);
  });
});

describe("runWithOrphanedAccountSelfHeal — at-most-once recovery", () => {
  const orphanError = () =>
    stripeApiError({
      type: "invalid_request_error",
      code: "account_invalid",
      statusCode: 400,
      message:
        "You requested an account link for an account that is not connected to your platform or does not exist.",
    });

  it("returns the op result without recreating when the first attempt succeeds", async () => {
    const runOp = vi.fn(async (acct: string) => `link-for-${acct}`);
    const recreateAccount = vi.fn(async () => "acct_new");

    const result = await runWithOrphanedAccountSelfHeal({
      accountId: "acct_old",
      runOp,
      recreateAccount,
    });

    expect(result).toBe("link-for-acct_old");
    expect(runOp).toHaveBeenCalledTimes(1);
    expect(recreateAccount).not.toHaveBeenCalled();
  });

  it("on an orphaned first attempt: recreates ONCE, retries with the fresh id, succeeds", async () => {
    const runOp = vi
      .fn<(acct: string) => Promise<string>>()
      .mockRejectedValueOnce(orphanError())
      .mockResolvedValueOnce("link-for-acct_new");
    const recreateAccount = vi.fn(async () => "acct_new");
    const onRecreate = vi.fn();

    const result = await runWithOrphanedAccountSelfHeal({
      accountId: "acct_old",
      runOp,
      recreateAccount,
      onRecreate,
    });

    expect(result).toBe("link-for-acct_new");
    expect(recreateAccount).toHaveBeenCalledTimes(1);
    expect(runOp).toHaveBeenCalledTimes(2);
    expect(runOp).toHaveBeenNthCalledWith(1, "acct_old");
    expect(runOp).toHaveBeenNthCalledWith(2, "acct_new");
    expect(onRecreate).toHaveBeenCalledExactlyOnceWith("acct_old");
  });

  it("does NOT recreate a second time when the retry also orphans — surfaces the real error (no loop)", async () => {
    const second = orphanError();
    const runOp = vi
      .fn<(acct: string) => Promise<string>>()
      .mockRejectedValueOnce(orphanError())
      .mockRejectedValueOnce(second);
    const recreateAccount = vi.fn(async () => "acct_new");

    await expect(
      runWithOrphanedAccountSelfHeal({
        accountId: "acct_old",
        runOp,
        recreateAccount,
      }),
    ).rejects.toBe(second);

    expect(recreateAccount).toHaveBeenCalledTimes(1);
    expect(runOp).toHaveBeenCalledTimes(2);
  });

  it("does NOT recreate when the op fails with a non-orphan error — rethrows unchanged", async () => {
    const authError = new Stripe.errors.StripeAuthenticationError({
      message: "Invalid API Key provided",
      statusCode: 401,
    } as never);
    const runOp = vi
      .fn<(acct: string) => Promise<string>>()
      .mockRejectedValue(authError);
    const recreateAccount = vi.fn(async () => "acct_new");

    await expect(
      runWithOrphanedAccountSelfHeal({
        accountId: "acct_old",
        runOp,
        recreateAccount,
      }),
    ).rejects.toBe(authError);

    expect(runOp).toHaveBeenCalledTimes(1);
    expect(recreateAccount).not.toHaveBeenCalled();
  });

  it("propagates a recreateAccount failure without retrying the op again", async () => {
    const recreateFailure = new Error("accounts.create failed");
    const runOp = vi
      .fn<(acct: string) => Promise<string>>()
      .mockRejectedValueOnce(orphanError());
    const recreateAccount = vi.fn(async () => {
      throw recreateFailure;
    });

    await expect(
      runWithOrphanedAccountSelfHeal({
        accountId: "acct_old",
        runOp,
        recreateAccount,
      }),
    ).rejects.toBe(recreateFailure);

    expect(recreateAccount).toHaveBeenCalledTimes(1);
    expect(runOp).toHaveBeenCalledTimes(1); // retry never reached
  });
});
