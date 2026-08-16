import { NextResponse } from "next/server";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import {
  automaticRefundProgressCap,
  automaticRefundWindowDays,
  isRefundableEnrollmentSource,
  paidOrderRefundQuerySpec,
} from "@/lib/payments/rules";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// Self-serve refund request (ported from Firebase requestRefund). Enforces the
// automatic-refund policy EXACTLY: paid enrollment, active/completed, under the
// progress cap, no issued certificate, a matching paid order still inside the
// automaticRefundWindowDays window. Issues a full Stripe refund against the
// order's payment_intent; the charge.refunded WEBHOOK drives the order/ledger/
// enrollment state machine. All reads/writes use the service-role admin client.

export async function POST(request: Request) {
  try {
    const uid = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as {
      enrollmentId?: string;
    };

    const enrollmentId = String(body?.enrollmentId || "").trim();
    if (!enrollmentId || enrollmentId.length > 220) {
      throw new PaymentError("A valid enrollmentId is required.", 400);
    }

    await enforceRateLimit(`refund_${uid}`, 5, 60 * 60 * 1000);

    const admin = getSupabaseAdminClient();

    const { data: enrollment } = await admin
      .from("enrollments")
      .select("user_id, course_id, source, status, progress_percent")
      .eq("id", enrollmentId)
      .maybeSingle();

    if (!enrollment) {
      throw new PaymentError("Enrollment not found.", 404);
    }

    if (enrollment.user_id !== uid) {
      throw new PaymentError(
        "You can only request refunds for your own enrollments.",
        403,
        "permission_denied",
      );
    }

    if (!isRefundableEnrollmentSource(enrollment.source)) {
      throw new PaymentError("Only paid enrollments can request a refund.", 400);
    }

    if (!["active", "completed"].includes(enrollment.status)) {
      throw new PaymentError(
        "This enrollment is not eligible for a refund.",
        400,
      );
    }

    if ((enrollment.progress_percent ?? 0) >= automaticRefundProgressCap) {
      throw new PaymentError(
        "Automatic refunds are unavailable after substantial course progress.",
        400,
      );
    }

    const { data: certificate, error: certificateError } = await admin
      .from("certificates")
      .select("status")
      .eq("id", enrollmentId)
      .maybeSingle();
    // Fail closed: a read failure here is indistinguishable from "no
    // certificate", and swallowing it lets an issued-certificate refund
    // through. Money path — same handling as priorRefundError below.
    if (certificateError) {
      throw new Error(certificateError.message);
    }

    if (certificate && certificate.status === "issued") {
      throw new PaymentError(
        "This enrollment already has an issued certificate.",
        400,
      );
    }

    // One AUTOMATIC refund per course per user — a prior refunded order (or a
    // refund request already in flight) routes the next one to support. Closes
    // the buy→refund→rebuy→refund loop that repurchase-after-refund allows,
    // and doubles as the same-order duplicate-request guard before the
    // charge.refunded webhook lands.
    const { data: priorRefund, error: priorRefundError } = await admin
      .from("orders")
      .select("id")
      .eq("user_id", uid)
      .eq("course_id", enrollment.course_id)
      .or("status.in.(refunded,partially_refunded),refund_request_id.not.is.null")
      .limit(1)
      .maybeSingle();
    if (priorRefundError) {
      throw new Error(priorRefundError.message);
    }
    if (priorRefund) {
      throw new PaymentError(
        "A refund was already issued for this course. Contact support for further help.",
        409,
      );
    }

    const querySpec = paidOrderRefundQuerySpec(uid, enrollment.course_id);
    // Firestore field names -> snake_case columns. The spec is (user_id,
    // course_id, status=paid), limit 1 — reproduced as chained eq filters.
    let orderQuery = admin
      .from("orders")
      .select(
        "id, payment_intent_id, paid_at, created_at, teacher_stripe_connected_account_id",
      );
    for (const [field, , value] of querySpec.filters) {
      const column =
        field === "userId"
          ? "user_id"
          : field === "courseId"
            ? "course_id"
            : field; // "status"
      orderQuery = orderQuery.eq(column, value);
    }

    const { data: order } = await orderQuery
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(querySpec.limit)
      .maybeSingle();

    if (!order) {
      throw new PaymentError("Paid order not found.", 404);
    }

    const paidAtMillis =
      (order.paid_at ? Date.parse(order.paid_at) : NaN) ||
      (order.created_at ? Date.parse(order.created_at) : NaN) ||
      0;
    const refundDeadline =
      paidAtMillis + automaticRefundWindowDays * 24 * 60 * 60 * 1000;

    if (!paidAtMillis || Date.now() > refundDeadline) {
      throw new PaymentError("The automatic refund window has ended.", 400);
    }

    const paymentIntentId = String(order.payment_intent_id || "");
    if (!paymentIntentId) {
      throw new PaymentError("Payment intent not found.", 400);
    }

    // DIRECT CHARGES: the PaymentIntent lives on the teacher's connected
    // account, so the refund must be created there too — a platform-scoped
    // refund would 404. `refund_application_fee` gives our commission back with
    // the sale: the teacher must never eat our fee on a sale that was undone.
    // The account id is the FROZEN snapshot taken at checkout, so a teacher who
    // later reconnects a different Stripe account can still be refunded.
    const connectedAccountId = String(
      order.teacher_stripe_connected_account_id || "",
    );
    if (!connectedAccountId) {
      throw new PaymentError(
        "This order has no connected account on record. Contact support.",
        409,
      );
    }

    const stripe = getStripeClient();
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        refund_application_fee: true,
        metadata: {
          orderId: order.id,
          enrollmentId,
          userId: uid,
          courseId: enrollment.course_id,
          source: "student_request",
        },
      },
      {
        idempotencyKey: `refund_${order.id}`,
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
      .eq("id", order.id);

    // ponytail: dropped captureServerEvent + recordAuditEvent (analytics
    // side-channel; no gate or return-shape depends on them).

    return NextResponse.json({ refundId: refund.id, status: refund.status });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
