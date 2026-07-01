"use client";

import { postPaymentRoute } from "@/lib/payments/client-fetch";

type RequestRefundResult = {
  refundId: string;
  status: string | null;
};

export async function requestEnrollmentRefund(enrollmentId: string) {
  return postPaymentRoute<RequestRefundResult>(
    "/api/payments/refunds/request",
    { enrollmentId },
  );
}

/**
 * Admin-initiated refund (full or partial). Gated server-side on the admin
 * role; the order/ledger/enrollment state transition flows through the
 * charge.refunded webhook. `amountMinor` omitted means a full refund.
 */
export async function issueAdminRefund(orderId: string, amountMinor?: number) {
  return postPaymentRoute<RequestRefundResult>("/api/payments/refunds/admin", {
    orderId,
    ...(amountMinor !== undefined ? { amountMinor } : {}),
  });
}
