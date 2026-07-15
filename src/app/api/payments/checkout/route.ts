import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  normalizeAffiliateRef,
  resolveAffiliateAttribution,
} from "@/domain/affiliate-attribution";
import type { CourseCoupon } from "@/domain/course-commerce";
import { normalizeCouponCode } from "@/domain/course-commerce";
import { redeemCourseCoupon } from "@/domain/coupon-redemption";
import { canonicalPlatformFeeBpsForPlan } from "@/lib/payments/rules";
import {
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { getStripeClient } from "@/lib/payments/server/stripe";
import {
  courseSubscriptionInterval,
  getCourseRow,
  getUserRow,
  getOrCreateBillingStripeCustomer,
  getOrCreateCourseSubscriptionPrice,
  loadCourseProductOffers,
  normalizeCoursePrice,
} from "@/lib/payments/server/stripe-helpers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/payments/checkout — opens a Stripe Checkout Session for a paid
// course. Faithful port of the createCheckoutSession Firebase callable
// (functions/src/index.ts). Two flows: a recurring `subscription` checkout for
// subscription courses, and the one-time `payment` flow guarded by the B3
// checkout lock (claim_checkout_lock RPC) so a double-click never opens two
// charges. Free enrollment is a separate rpc (create_free_course_enrollment),
// called directly by the client — not this route.
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as {
      courseId?: unknown;
      couponCode?: unknown;
      affiliateRef?: unknown;
    };
    const courseId = String(body.courseId ?? "").trim();
    const couponCodeRaw = String(body.couponCode ?? "").trim();
    const affiliateRefRaw = normalizeAffiliateRef(
      String(body.affiliateRef ?? "").trim(),
    );

    if (!courseId || courseId.length > 160) {
      throw new PaymentError("A valid courseId is required.");
    }

    const rate = await createSupabaseServerClient();
    const { error: rateError } = await rate.rpc("enforce_rate_limit", {
      p_key: `checkout_${userId}`,
      p_limit: 10,
      p_window_ms: 60 * 60 * 1000,
    });
    if (rateError) {
      if (rateError.message?.includes("RATE_LIMIT")) {
        throw new PaymentError(
          "Too many attempts. Please wait before trying again.",
          429,
        );
      }
      throw new Error(rateError.message);
    }

    const course = await getCourseRow(courseId);
    if (!course) {
      throw new PaymentError("Course not found.", 404);
    }

    // Sell-on-submit: a course that left draft (in_review) sells immediately;
    // approval is non-blocking. inactive/needs_changes blocks purchase again.
    if (course.status !== "published" && course.status !== "in_review") {
      throw new PaymentError(
        "This course is not available for purchase right now.",
      );
    }

    // A teacher buying their own course would pay themselves (minus fee) and
    // pollute their own enrollment/progress analytics.
    if (course.owner_id === userId) {
      throw new PaymentError("You can't purchase your own course.");
    }

    // Dual-read: optional offer/price packages, else legacy course columns.
    const offers = await loadCourseProductOffers(courseId);
    const priced = normalizeCoursePrice(course, offers);
    let amountMinor = priced.amountMinor;
    const currency = priced.currency;
    let appliedCouponCode: string | null = null;
    let discountMinor = 0;

    const admin = getSupabaseAdminClient();

    // Hotmart-parity: redeem active course coupon at checkout (one-time only).
    if (couponCodeRaw) {
      const code = normalizeCouponCode(couponCodeRaw);
      const { data: couponRow, error: couponError } = await admin
        .from("course_coupons")
        .select("*")
        .eq("course_id", courseId)
        .eq("code", code)
        .maybeSingle();
      if (couponError) {
        throw new Error(couponError.message);
      }
      const coupon: CourseCoupon | null = couponRow
        ? {
            id: couponRow.id,
            courseId: couponRow.course_id,
            ownerId: couponRow.owner_id,
            code: couponRow.code,
            percentOff: couponRow.percent_off,
            maxRedemptions: couponRow.max_redemptions,
            redeemedCount: couponRow.redeemed_count,
            expiresAt: couponRow.expires_at ?? undefined,
            active: couponRow.active,
            createdAt: couponRow.created_at,
            updatedAt: couponRow.updated_at,
          }
        : null;
      const redemption = redeemCourseCoupon({
        amountMinor,
        coupon,
      });
      if (!redemption.ok) {
        throw new PaymentError(redemption.reason);
      }
      // Subscriptions: percent-off coupons need Stripe coupons; keep simple —
      // only one-time checkouts accept percent coupons here.
      if (courseSubscriptionInterval(priced.paymentType ?? course.payment_type)) {
        throw new PaymentError(
          "Coupons on subscription checkouts are not supported yet. Use a one-time product.",
        );
      }
      amountMinor = redemption.amountMinorAfter;
      appliedCouponCode = redemption.code;
      discountMinor = redemption.discountMinor;
    }

    // Hotmart-parity: capture affiliate ref on the money path (metadata).
    // Soft-fail when disabled/invalid so checkout still completes.
    let affiliateUserId: string | null = null;
    let affiliateCommissionMinor = 0;
    let affiliateCommissionPct = 0;
    if (affiliateRefRaw) {
      const { data: commerceSettings } = await admin
        .from("course_commerce_settings")
        .select("affiliate_enabled,affiliate_commission_pct")
        .eq("course_id", courseId)
        .maybeSingle();
      const attribution = resolveAffiliateAttribution({
        affiliateRef: affiliateRefRaw,
        buyerUserId: userId,
        teacherUserId: course.owner_id,
        affiliateEnabled: Boolean(commerceSettings?.affiliate_enabled),
        commissionPct: Number(commerceSettings?.affiliate_commission_pct ?? 0),
        amountMinor,
      });
      if (attribution.ok) {
        const { data: affiliateUser } = await admin
          .from("users")
          .select("uid")
          .eq("uid", attribution.affiliateUserId)
          .maybeSingle();
        if (affiliateUser?.uid) {
          affiliateUserId = attribution.affiliateUserId;
          affiliateCommissionMinor = attribution.commissionMinor;
          affiliateCommissionPct = attribution.commissionPct;
        }
      }
    }

    const enrollmentId = `${userId}__${courseId}`;
    const { data: existingEnrollment, error: enrollmentError } = await admin
      .from("enrollments")
      .select("status")
      .eq("id", enrollmentId)
      .maybeSingle();
    if (enrollmentError) {
      throw new Error(enrollmentError.message);
    }
    if (
      existingEnrollment &&
      ["active", "completed"].includes(String(existingEnrollment.status))
    ) {
      throw new PaymentError(
        "This course is already attached to your learning workspace.",
        409,
      );
    }

    const buyer = await getUserRow(userId);
    const userEmail = buyer?.email ?? undefined;
    const appUrl = getAppUrl();
    const stripe = getStripeClient();

    const owner = await getUserRow(course.owner_id);
    const platformFeeBps = canonicalPlatformFeeBpsForPlan(owner?.current_plan_id);
    const connectedAccountId =
      course.stripe_connected_account_id ??
      owner?.stripe_connected_account_id ??
      null;

    if (!connectedAccountId) {
      throw new PaymentError(
        "This teacher has not connected Stripe payouts yet.",
      );
    }

    if (
      owner &&
      owner.stripe_connected_account_id === connectedAccountId &&
      (!owner.stripe_connect_charges_enabled ||
        !owner.stripe_connect_payouts_enabled)
    ) {
      throw new PaymentError(
        "This teacher must finish Stripe onboarding before paid checkout opens.",
      );
    }

    // --- Course subscription checkout (recurring) --------------------------
    // Prefer payment type from dual-read resolution (offer may override legacy).
    const subscriptionInterval = courseSubscriptionInterval(
      priced.paymentType ?? course.payment_type,
    );
    if (subscriptionInterval) {
      const customerId = await getOrCreateBillingStripeCustomer(
        stripe,
        userId,
        userEmail ?? null,
      );
      const subscriptionPriceId =
        priced.stripePriceId
        || (await getOrCreateCourseSubscriptionPrice(
          stripe,
          course,
          courseId,
          amountMinor,
          currency,
          subscriptionInterval,
        ));

      const subscriptionSession = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer: customerId,
          line_items: [{ price: subscriptionPriceId, quantity: 1 }],
          // Carry the full fulfilment context on the SUBSCRIPTION so every
          // future invoice.paid / lifecycle event resolves course, buyer,
          // teacher, connected account and fee without a DB lookup.
          subscription_data: {
            metadata: {
              purpose: "course_subscription",
              courseId,
              courseSlug: courseId,
              userId,
              teacherId: course.owner_id,
              connectedAccountId,
              platformFeeBps: String(platformFeeBps),
              currency: currency.toUpperCase(),
              ...(affiliateUserId
                ? {
                    affiliateUserId,
                    affiliateCommissionPct: String(affiliateCommissionPct),
                    affiliateCommissionMinor: String(affiliateCommissionMinor),
                  }
                : {}),
            },
          },
          metadata: {
            purpose: "course_subscription",
            courseId,
            courseSlug: courseId,
            userId,
            teacherId: course.owner_id,
            ...(affiliateUserId ? { affiliateUserId } : {}),
          },
          success_url: `${appUrl}/learn/courses/${encodeURIComponent(courseId)}?checkout=success`,
          cancel_url: `${appUrl}/courses/${encodeURIComponent(courseId)}?checkout=cancelled`,
        },
        {
          idempotencyKey: `course_sub_checkout_${userId}_${courseId}_${Math.floor(
            Date.now() / 60000,
          )}`,
        },
      );

      if (!subscriptionSession.url) {
        throw new Error("Stripe did not return a Checkout URL.");
      }

      return NextResponse.json({ url: subscriptionSession.url });
    }

    // --- One-time checkout with the B3 in-flight lock ----------------------
    // The lock (claim_checkout_lock RPC) is claimed AFTER all validation so a
    // rejected request never holds it. The session below expires in 31 min; the
    // lock's session TTL sits a few minutes past it so a takeover never races a
    // still-payable session.
    const checkoutSessionExpiresInSec = 31 * 60;
    const nowIso = new Date().toISOString();
    const orderId = crypto.randomUUID();

    const { data: lockRows, error: lockError } = await admin.rpc(
      "claim_checkout_lock",
      {
        p_user_id: userId,
        p_course_id: courseId,
        p_order_id: orderId,
        p_now: nowIso,
        p_session_ttl_ms: (checkoutSessionExpiresInSec + 4 * 60) * 1000, // 35 min
        p_claim_grace_ms: 2 * 60 * 1000,
      },
    );
    if (lockError) {
      throw new Error(lockError.message);
    }
    const lock = lockRows?.[0];

    if (lock?.action === "reuse" && lock.checkout_url) {
      // A sibling request already has a live session — hand back the SAME url.
      return NextResponse.json({ url: lock.checkout_url });
    }
    if (lock?.action === "wait") {
      throw new PaymentError(
        "A checkout for this course is already starting. Please try again in a moment.",
        409,
      );
    }

    const { error: orderError } = await admin.from("orders").insert({
      id: orderId,
      user_id: userId,
      teacher_id: course.owner_id,
      teacher_stripe_connected_account_id: connectedAccountId,
      course_id: courseId,
      course_slug: courseId,
      course_title: course.title,
      amount_minor: amountMinor,
      currency: currency.toUpperCase(),
      platform_fee_bps: platformFeeBps,
      payout_model: "separate_charges_and_transfers",
      status: "pending",
      provider: "stripe",
      checkout_session_id: null,
      payment_intent_id: null,
      created_at: nowIso,
      updated_at: nowIso,
    });
    if (orderError) {
      throw new Error(orderError.message);
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      customer_email: userEmail,
      client_reference_id: userId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amountMinor,
            product_data: {
              name: course.title,
              description: course.summary?.slice(0, 900),
              images: course.cover_image_url ? [course.cover_image_url] : undefined,
              metadata: { courseId, ownerId: course.owner_id },
            },
          },
        },
      ],
      metadata: {
        orderId,
        courseId,
        courseSlug: courseId,
        userId,
        ...(appliedCouponCode
          ? {
              couponCode: appliedCouponCode,
              discountMinor: String(discountMinor),
            }
          : {}),
        ...(affiliateUserId
          ? {
              affiliateUserId,
              affiliateCommissionPct: String(affiliateCommissionPct),
              affiliateCommissionMinor: String(affiliateCommissionMinor),
            }
          : {}),
      },
      payment_intent_data: {
        metadata: {
          orderId,
          courseId,
          courseSlug: courseId,
          userId,
          ...(appliedCouponCode ? { couponCode: appliedCouponCode } : {}),
          ...(affiliateUserId ? { affiliateUserId } : {}),
        },
      },
      expires_at: Math.floor(Date.now() / 1000) + checkoutSessionExpiresInSec,
      success_url: `${appUrl}/learn/courses/${encodeURIComponent(courseId)}?checkout=success`,
      cancel_url: `${appUrl}/courses/${encodeURIComponent(courseId)}?checkout=cancelled`,
    };

    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `checkout_${orderId}`,
    });

    await admin
      .from("orders")
      .update({ checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq("id", orderId);

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL.");
    }

    // Publish the live session on the lock so a concurrent sibling reuses THIS
    // url instead of opening a second charge. [B3]
    await admin
      .from("checkout_locks")
      .update({
        checkout_url: session.url,
        order_id: orderId,
        checkout_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq("lock_key", `${userId}__${courseId}`);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
