import { PaymentError } from "@/lib/payments/server/auth";
import { getUserRow } from "@/lib/payments/server/stripe-helpers";
import type { getSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof getSupabaseAdminClient>;

export async function getCourseSubscriptionCancellationContext(
  admin: AdminClient,
  userId: string,
  courseId: string,
): Promise<{ subscriptionId: string; stripeAccount: string | null }> {
  try {
    const { data: enrollment, error: enrollmentError } = await admin
      .from("enrollments")
      .select("subscription_id")
      .eq("id", `${userId}__${courseId}`)
      .maybeSingle();
    if (enrollmentError) throw enrollmentError;

    const subscriptionId = enrollment?.subscription_id;
    if (typeof subscriptionId !== "string" || !subscriptionId) {
      throw new PaymentError(
        "No course subscription is attached to your enrollment.",
        400,
      );
    }

    // Invoice history belongs to this subscription, unlike the latest paid
    // purchase of the course. Refunded invoices still identify its account.
    const { data: ledger, error: ledgerError } = await admin
      .from("payout_ledger")
      .select("teacher_stripe_connected_account_id")
      .eq("subscription_id", subscriptionId)
      .eq("course_id", courseId)
      .eq("kind", "course_subscription")
      .not("teacher_stripe_connected_account_id", "is", null)
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (ledgerError) throw ledgerError;
    if (ledger?.teacher_stripe_connected_account_id) {
      return { subscriptionId, stripeAccount: ledger.teacher_stripe_connected_account_id };
    }

    // A zero-value invoice has an order but no earnings ledger. Resolve its
    // exact order through the subscription mirror, without a paid-only filter.
    const { data: mirror, error: mirrorError } = await admin
      .from("course_subscriptions")
      .select("latest_invoice_id")
      .eq("id", subscriptionId)
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .maybeSingle();
    if (mirrorError) throw mirrorError;
    if (mirror?.latest_invoice_id) {
      const { data: invoiceOrder, error: invoiceError } = await admin
        .from("orders")
        .select("teacher_stripe_connected_account_id")
        .eq("id", mirror.latest_invoice_id)
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .maybeSingle();
      if (invoiceError) throw invoiceError;
      if (invoiceOrder?.teacher_stripe_connected_account_id) {
        return { subscriptionId, stripeAccount: invoiceOrder.teacher_stripe_connected_account_id };
      }
    }

    // Older records may lack invoice links. Keep their existing lookup path;
    // the caller must verify the Stripe object's ownership before writing.
    const { data: paidOrder, error: orderError } = await admin
      .from("orders")
      .select("teacher_stripe_connected_account_id")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .eq("status", "paid")
      .not("teacher_stripe_connected_account_id", "is", null)
      .order("paid_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (orderError) throw orderError;
    if (paidOrder?.teacher_stripe_connected_account_id) {
      return { subscriptionId, stripeAccount: paidOrder.teacher_stripe_connected_account_id };
    }

    const { data: course, error: courseError } = await admin
      .from("courses")
      .select("stripe_connected_account_id, owner_id")
      .eq("id", courseId)
      .maybeSingle();
    if (courseError) throw courseError;
    if (course?.stripe_connected_account_id) {
      return { subscriptionId, stripeAccount: course.stripe_connected_account_id };
    }

    const owner = course?.owner_id ? await getUserRow(course.owner_id) : null;
    return { subscriptionId, stripeAccount: owner?.stripe_connected_account_id || null };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      "Your subscription details could not be verified. Please try again or contact support. No change was made.",
      503,
      "subscription_context_unavailable",
    );
  }
}
