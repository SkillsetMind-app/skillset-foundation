// "settled" is the only status new rows are written with under direct charges:
// the buyer paid the teacher's connected account, so the money is already in
// their Stripe balance and there is nothing for the platform to release.
// The four release-model values below survive only for historical rows.
export type PayoutLedgerStatus =
  | "settled"
  | "in_release"
  | "releasing"
  | "released"
  | "released_advance"
  | "disputed"
  | "refunded"
  | "partially_refunded";

export type PayoutLedgerEntry = {
  id: string;
  teacherId: string;
  teacherStripeConnectedAccountId?: string | null;
  courseId: string;
  orderId: string;
  paymentId: string;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  kind?: string | null;
  grossAmountMinor: number;
  skillsetFeeMinor: number;
  stripeFeeMinor?: number;
  netAmountMinor: number;
  currency: string;
  platformFeeBps?: number;
  status: PayoutLedgerStatus;
  releaseAt?: unknown;
  transferId?: string | null;
  refundedAmountMinor?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};
