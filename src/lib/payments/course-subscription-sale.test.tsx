import { describe, expect, it } from "vitest";

import { buildCourseSubscriptionSaleRecords } from "@/lib/payments/course-subscription-sale";

const invoice = {
  invoiceId: "in_renewal_123",
  paymentId: "pi_renewal_123",
  paymentIntentId: "pi_renewal_123",
  subscriptionId: "sub_123",
  userId: "learner_123",
  teacherId: "teacher_123",
  connectedAccountId: "acct_123",
  courseId: "course_123",
  courseSlug: "mental-performance",
  courseTitle: "Mental Performance",
  grossAmountMinor: 12900,
  currency: "BRL",
  platformFeeBps: 800,
  platformFeeMinor: 1032 + 30,
  createdAt: "2026-07-15T10:00:00.000Z",
  paidAt: "2026-07-15T10:00:05.000Z",
  updatedAt: "2026-07-15T10:00:05.000Z",
  receiptUrl: "https://pay.stripe.com/receipts/renewal-123",
} as const;

describe("buildCourseSubscriptionSaleRecords", () => {
  it("materializes every paid subscription invoice as a reportable order and payment", () => {
    expect(buildCourseSubscriptionSaleRecords(invoice)).toEqual({
      order: {
        id: "in_renewal_123",
        user_id: "learner_123",
        teacher_id: "teacher_123",
        course_id: "course_123",
        course_slug: "mental-performance",
        course_title: "Mental Performance",
        amount_minor: 12900,
        currency: "BRL",
        status: "paid",
        provider: "stripe",
        platform_fee_bps: 800,
        platform_fee_fixed_minor: 30,
        // Direct charge, not separate charges + transfers: SkillsetMind never
        // takes possession of the renewal, so the books must not claim a
        // transfer we never owe. Flipping this back is a policy regression.
        payout_model: "direct_charge",
        teacher_stripe_connected_account_id: "acct_123",
        payment_intent_id: "pi_renewal_123",
        receipt_url: "https://pay.stripe.com/receipts/renewal-123",
        paid_at: "2026-07-15T10:00:05.000Z",
        created_at: "2026-07-15T10:00:00.000Z",
        updated_at: "2026-07-15T10:00:05.000Z",
      },
      payment: {
        id: "pi_renewal_123",
        order_id: "in_renewal_123",
        user_id: "learner_123",
        course_id: "course_123",
        amount_minor: 12900,
        currency: "BRL",
        status: "succeeded",
        provider: "stripe",
        provider_payment_id: "pi_renewal_123",
        receipt_url: "https://pay.stripe.com/receipts/renewal-123",
        created_at: "2026-07-15T10:00:00.000Z",
        updated_at: "2026-07-15T10:00:05.000Z",
      },
    });
  });

  it("is deterministic for webhook redelivery and supports a zero-value invoice key", () => {
    const zeroValueInvoice = {
      ...invoice,
      invoiceId: "in_trial_123",
      paymentId: "in_trial_123",
      paymentIntentId: null,
      grossAmountMinor: 0,
      receiptUrl: null,
    };

    expect(buildCourseSubscriptionSaleRecords(zeroValueInvoice)).toEqual(
      buildCourseSubscriptionSaleRecords(zeroValueInvoice),
    );
    expect(buildCourseSubscriptionSaleRecords(zeroValueInvoice).payment.id).toBe(
      "in_trial_123",
    );
  });

  // The ledger books the fee Stripe took (invoice.application_fee_amount);
  // sale detail and ops recompute floor(gross × bps) + fixed from the order.
  // A $19 renewal frozen at 5% but charged 4.9% + $0.30 = $1.23 must read
  // $1.23 there too, not $0.95.
  it("stores the fixed part so the order adds up to the fee Stripe took", () => {
    const { order } = buildCourseSubscriptionSaleRecords({
      ...invoice,
      grossAmountMinor: 1900,
      currency: "USD",
      platformFeeBps: 500,
      platformFeeMinor: 123,
    });
    expect(order.platform_fee_fixed_minor).toBe(28);
    expect(Math.floor((1900 * order.platform_fee_bps!) / 10000) + order.platform_fee_fixed_minor!).toBe(123);
  });

  it("never stores a negative fixed part", () => {
    const { order } = buildCourseSubscriptionSaleRecords({ ...invoice, platformFeeMinor: 0 });
    expect(order.platform_fee_fixed_minor).toBe(0);
  });
});
