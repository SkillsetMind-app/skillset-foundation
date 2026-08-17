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
