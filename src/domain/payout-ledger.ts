export type PayoutLedgerStatus =
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
  releasedAt?: unknown;
  transferId?: string | null;
  refundedAmountMinor?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};
