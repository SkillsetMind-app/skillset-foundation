export type OrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "cancelled";

export type PaymentProvider = "stripe";

export type Order = {
  id: string;
  userId: string;
  teacherId?: string;
  teacherStripeConnectedAccountId?: string | null;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  amountMinor: number;
  /**
   * Cumulative amount refunded on this order, in minor units, mirrored from the
   * charge by the refund webhook. Absent (treat as 0) on orders that never had
   * a refund. Net paid = amountMinor - (refundedAmountMinor ?? 0).
   */
  refundedAmountMinor?: number;
  currency: string;
  platformFeeBps: number;
  /**
   * How the money moved. "direct_charge" is the ONLY model SkillsetMind uses:
   * the buyer is charged on the teacher's own connected account and the
   * platform takes an application fee. The other two are legacy values that
   * only exist because old rows carry them — writing either one on a new order
   * would claim SkillsetMind took possession of the teacher's money, which is
   * exactly the legal position the direct-charge model exists to avoid.
   */
  payoutModel?:
    | "direct_charge"
    | "separate_charges_and_transfers"
    | "destination_charge";
  status: OrderStatus;
  provider: PaymentProvider;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  /**
   * Stripe hosted receipt URL (charge.receipt_url), captured by the checkout
   * webhook for one-off course purchases. Absent on orders that predate
   * receipt capture or that never reached a paid charge.
   */
  receiptUrl?: string | null;
  createdAt?: unknown;
  paidAt?: unknown;
  updatedAt?: unknown;
};

export type Payment = {
  id: string;
  orderId: string;
  userId: string;
  amountMinor: number;
  currency: string;
  provider: PaymentProvider;
  providerPaymentId: string;
  receiptUrl?: string | null;
  courseId?: string;
  refundedAmountMinor?: number;
  status: "succeeded" | "failed" | "refunded" | "partially_refunded";
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function isPaidOrder(status: OrderStatus): boolean {
  return status === "paid";
}
