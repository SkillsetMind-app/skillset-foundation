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
  payoutModel?: "separate_charges_and_transfers" | "destination_charge";
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
