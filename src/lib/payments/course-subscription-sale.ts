import type { Database } from "@/lib/supabase/database.types";

type OrderInsert = Database["public"]["Tables"]["orders"]["Insert"];
type PaymentInsert = Database["public"]["Tables"]["payments"]["Insert"];

export type CourseSubscriptionSaleInput = {
  invoiceId: string;
  paymentId: string;
  paymentIntentId: string | null;
  subscriptionId: string;
  userId: string;
  teacherId: string;
  connectedAccountId: string | null;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  grossAmountMinor: number;
  currency: string;
  platformFeeBps: number;
  /** The fee Stripe actually took on this invoice, in the stored unit. */
  platformFeeMinor: number;
  createdAt: string;
  paidAt: string;
  updatedAt: string;
  receiptUrl?: string | null;
};

/**
 * Creates the immutable financial facts for one paid subscription invoice.
 * Stripe invoice and payment ids make webhook redelivery deterministic.
 */
export function buildCourseSubscriptionSaleRecords(
  input: CourseSubscriptionSaleInput,
): { order: OrderInsert; payment: PaymentInsert } {
  const receiptUrl = input.receiptUrl ?? null;

  return {
    order: {
      id: input.invoiceId,
      user_id: input.userId,
      teacher_id: input.teacherId,
      course_id: input.courseId,
      course_slug: input.courseSlug,
      course_title: input.courseTitle,
      amount_minor: input.grossAmountMinor,
      currency: input.currency,
      status: "paid",
      provider: "stripe",
      platform_fee_bps: input.platformFeeBps,
      // Sale detail and the ops overview read the fee back as
      // floor(gross × bps) + fixed, so the fixed part is whatever the real fee
      // adds on top of the percent. Then they match the ledger. It can go
      // negative after a plan upgrade (frozen percent above the new fee);
      // platformFeeForSale adds it back to the exact fee.
      platform_fee_fixed_minor:
        input.platformFeeMinor - Math.floor((input.grossAmountMinor * input.platformFeeBps) / 10000),
      // Direct charge, same as the one-time path. The renewal is charged on the
      // teacher's connected account with an application fee; SkillsetMind never
      // receives the money and owes no transfer. Writing the legacy
      // separate-charges value here would put a false claim in the books.
      payout_model: "direct_charge",
      teacher_stripe_connected_account_id: input.connectedAccountId,
      payment_intent_id: input.paymentIntentId,
      receipt_url: receiptUrl,
      paid_at: input.paidAt,
      created_at: input.createdAt,
      updated_at: input.updatedAt,
    },
    payment: {
      id: input.paymentId,
      order_id: input.invoiceId,
      user_id: input.userId,
      course_id: input.courseId,
      amount_minor: input.grossAmountMinor,
      currency: input.currency,
      status: "succeeded",
      provider: "stripe",
      provider_payment_id: input.paymentId,
      receipt_url: receiptUrl,
      created_at: input.createdAt,
      updated_at: input.updatedAt,
    },
  };
}
