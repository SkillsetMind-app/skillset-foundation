import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireAdminUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// Admin refund (ported from Firebase issueAdminRefund). requireAdminUserId()
// replaces the roles.includes("admin") gate. Full refund when amountMinor is
// omitted, else a partial capped against what is STILL refundable (total −
// already refunded) so repeated partials can never exceed the original charge.
// The order/ledger/enrollment transition flows through the charge.refunded
// WEBHOOK — NOT duplicated here.

export async function POST(request: Request) {
  try {
    const callerId = await requireAdminUserId();
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string;
      amountMinor?: unknown;
    };

    const orderId = String(body?.orderId || "").trim();
    if (!orderId || orderId.length > 220) {
      throw new PaymentError("A valid orderId is required.", 400);
    }

    const rawAmount = body?.amountMinor;
    let amountMinor: number | null = null;
    if (rawAmount !== undefined && rawAmount !== null) {
      const parsed = Number(rawAmount);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new PaymentError(
          "amountMinor must be a positive integer in minor units.",
          400,
        );
      }
      amountMinor = parsed;
    }

    await enforceRateLimit(`admin_refund_${callerId}`, 30, 60 * 60 * 1000);

    const admin = getSupabaseAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select(
        "status, payment_intent_id, amount_minor, refunded_amount_minor, course_id, user_id, teacher_stripe_connected_account_id",
      )
      .eq("id", orderId)
      .maybeSingle();

    if (!order) {
      throw new PaymentError("Order not found.", 404);
    }

    if (order.status !== "paid" && order.status !== "partially_refunded") {
      throw new PaymentError("Only paid orders can be refunded.", 400);
    }

    const paymentIntentId = String(order.payment_intent_id || "");
    if (!paymentIntentId) {
      throw new PaymentError("Payment intent not found for this order.", 400);
    }

    const orderAmountMinor = Number(order.amount_minor || 0);
    // For a partially_refunded order, cap against what is STILL refundable
    // (total − already refunded), not the original total. Cap unconditionally:
    // a stored amount_minor of 0/null must FAIL the partial (not skip the cap),
    // so a corrupt/zero order can't wave a partial past this local guard —
    // Stripe caps at the captured amount too, but this is the first line.
    const alreadyRefundedMinor = Number(order.refunded_amount_minor || 0);
    const remainingRefundableMinor = orderAmountMinor - alreadyRefundedMinor;

    if (amountMinor !== null && amountMinor > remainingRefundableMinor) {
      throw new PaymentError(
        "Refund amount exceeds the remaining refundable balance.",
        400,
      );
    }

    // DIRECT CHARGES: the PaymentIntent belongs to the teacher's connected
    // account, so the refund is created there (a platform-scoped call 404s) and
    // is debited from the TEACHER's balance. `refund_application_fee` returns
    // our commission proportionally so the teacher never eats our fee on an
    // undone sale. The account id is the frozen snapshot from checkout time.
    const connectedAccountId = String(
      order.teacher_stripe_connected_account_id || "",
    );
    if (!connectedAccountId) {
      throw new PaymentError(
        "This order has no connected account on record; refund it from the Stripe dashboard.",
        409,
      );
    }

    const stripe = getStripeClient();
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        refund_application_fee: true,
        ...(amountMinor !== null ? { amount: amountMinor } : {}),
        metadata: {
          orderId,
          courseId: typeof order.course_id === "string" ? order.course_id : "",
          userId: typeof order.user_id === "string" ? order.user_id : "",
          source: "admin_request",
          adminId: callerId,
        },
      },
      {
        idempotencyKey:
          amountMinor !== null
            ? `admin_refund_${orderId}_${amountMinor}`
            : `admin_refund_${orderId}_full`,
        stripeAccount: connectedAccountId,
      },
    );

    await admin
      .from("orders")
      .update({
        refund_requested_at: new Date().toISOString(),
        refund_request_id: refund.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    // Audit trail: record who refunded what. The charge.refunded webhook does
    // the money/ledger transition; this is the who-did-what record so a rogue or
    // compromised admin action is investigable after the fact. Best-effort — a
    // logging failure must NEVER fail a refund Stripe already accepted.
    const { error: auditError } = await admin.from("audit_log").insert({
      id: randomUUID(),
      action: "refund.issued",
      actor_id: callerId,
      target_type: "order",
      target_id: orderId,
      summary: `Admin issued a ${
        amountMinor === null ? "full" : `${amountMinor} minor-unit`
      } refund on order ${orderId}`,
      metadata: {
        refundId: refund.id,
        amountMinor,
        courseId: typeof order.course_id === "string" ? order.course_id : null,
        buyerId: typeof order.user_id === "string" ? order.user_id : null,
      },
    });
    if (auditError) {
      console.error("admin refund: audit_log insert failed", auditError);
    }

    return NextResponse.json({ refundId: refund.id, status: refund.status });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
