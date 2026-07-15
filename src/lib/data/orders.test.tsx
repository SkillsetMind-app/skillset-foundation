import { describe, expect, it } from "vitest";

import { mapOrderRow } from "@/lib/data/orders";
import type { Database } from "@/lib/supabase/database.types";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

describe("mapOrderRow", () => {
  it("preserves authorization and financial detail fields", () => {
    const row: OrderRow = {
      amount_minor: 24900,
      checkout_session_id: "cs_123",
      course_id: "course-1",
      course_slug: "clinical-performance",
      course_title: "Clinical Performance",
      created_at: "2026-07-15T10:00:00.000Z",
      currency: "brl",
      id: "order-1",
      latest_transfer_reversal_at: null,
      latest_transfer_reversal_id: null,
      paid_at: "2026-07-15T10:01:00.000Z",
      payment_intent_id: "pi_123",
      payout_model: "destination_charge",
      platform_fee_bps: 950,
      provider: "stripe",
      receipt_url: "https://pay.example/receipt/1",
      refund_request_id: null,
      refund_requested_at: null,
      refunded_amount_minor: 4900,
      status: "partially_refunded",
      teacher_id: "teacher-1",
      teacher_stripe_connected_account_id: "acct_123",
      transfer_reversed_amount_minor: 4900,
      updated_at: "2026-07-15T11:00:00.000Z",
      user_id: "learner-1",
    };

    expect(mapOrderRow(row)).toMatchObject({
      id: "order-1",
      teacherId: "teacher-1",
      teacherStripeConnectedAccountId: "acct_123",
      refundedAmountMinor: 4900,
      receiptUrl: "https://pay.example/receipt/1",
      paidAt: "2026-07-15T10:01:00.000Z",
      updatedAt: "2026-07-15T11:00:00.000Z",
      payoutModel: "destination_charge",
    });
  });
});
