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
        payout_model: "separate_charges_and_transfers",
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
});
