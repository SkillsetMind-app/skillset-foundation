import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  normalizeAffiliateRef,
  resolveAffiliateAttribution,
} from "@/domain/affiliate-attribution";
import type { CourseCoupon } from "@/domain/course-commerce";
import { normalizeCouponCode } from "@/domain/course-commerce";
import { redeemCourseCoupon } from "@/domain/coupon-redemption";
import { buildInstallmentPlan } from "@/domain/installments";
import { isCoursePubliclySellable } from "@/domain/teacher-course";
import { canonicalPlatformFeeBpsForPlan } from "@/lib/payments/rules";
import {
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getAppUrl } from "@/lib/payments/server/app-url";
import {
  getStripeClient,
  getStripePlatformAccountCountry,
} from "@/lib/payments/server/stripe";
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

const COURSE_SUBSCRIPTION_CHECKOUT_BLOCKING_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
];

// POST /api/payments/checkout — opens a Stripe Checkout Session for a paid
// course. Faithful port of the createCheckoutSession Firebase callable
// (functions/src/index.ts). Two flows: a recurring `subscription` checkout for
// subscription courses, and the one-time `payment` flow guarded by the B3
// checkout lock (claim_checkout_lock RPC) so a double-click never opens two
// charges. Free enrollment is a separate rpc (create_free_course_enrollment),
// called directly by the client — not this route.
export async function POST(request: Request) {
  let releasableCouponReservation: {
    admin: ReturnType<typeof getSupabaseAdminClient>;
    orderId: string;
  } | null = null;

  try {
    const userId = await requireUserId();
    const admin = getSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as {
      courseId?: unknown;
      couponCode?: unknown;
      affiliateRef?: unknown;
      offerId?: unknown;
      offerCode?: unknown;
      priceId?: unknown;
    };
    const courseId = String(body.courseId ?? "").trim();
    const couponCodeRaw = String(body.couponCode ?? "").trim();
    const offerId = String(body.offerId ?? "").trim();
    const offerCode = String(body.offerCode ?? "").trim().toUpperCase();
    const priceId = String(body.priceId ?? "").trim();
    const affiliateRefRaw = normalizeAffiliateRef(
      String(body.affiliateRef ?? "").trim(),
    );

    if (!courseId || courseId.length > 160) {
      throw new PaymentError("A valid courseId is required.");
    }
    if (offerId.length > 160 || priceId.length > 160) {
      throw new PaymentError("The selected offer is invalid.");
    }
    if (offerCode.length > 24 || (offerCode && !/^[A-Z0-9-]+$/.test(offerCode))) {
      throw new PaymentError("The selected offer code is invalid.");
    }

    const { error: rateError } = await admin.rpc("enforce_rate_limit", {
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

    // Professional verification is the soft gate: creators can build while
    // pending, but only a directly published product can take payment.
    if (!isCoursePubliclySellable(course.status)) {
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
    const priced = normalizeCoursePrice(course, offers, {
      ...(offerId ? { offerId } : {}),
      ...(offerCode ? { publicCode: offerCode } : {}),
      ...(priceId ? { priceId } : {}),
    });
    let amountMinor = priced.amountMinor;
    const currency = priced.currency;
    let appliedCouponId: string | null = null;
    let appliedCouponCode: string | null = null;
    let discountMinor = 0;

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
      appliedCouponId = coupon?.id ?? null;
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

    const subscriptionInterval = courseSubscriptionInterval(
      priced.paymentType ?? course.payment_type,
    );
    if (subscriptionInterval) {
      const { data: existingSubscription, error: subscriptionError } = await admin
        .from("course_subscriptions")
        .select("id,status")
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .in("status", COURSE_SUBSCRIPTION_CHECKOUT_BLOCKING_STATUSES)
        .limit(1)
        .maybeSingle();
      if (subscriptionError) throw new Error(subscriptionError.message);
      if (existingSubscription) {
        throw new PaymentError(
          "You already have a subscription for this course.",
          409,
        );
      }
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
    if (subscriptionInterval) {
      const checkoutSessionExpiresInSec = 31 * 60;
      const lockTtlMs = (checkoutSessionExpiresInSec + 4 * 60) * 1000;
      const checkoutAttemptId = crypto.randomUUID();
      const lockKey = `${userId}__${courseId}`;
      const { data: lockRows, error: lockError } = await admin.rpc(
        "claim_checkout_lock",
        {
          p_user_id: userId,
          p_course_id: courseId,
          p_order_id: checkoutAttemptId,
          p_now: new Date().toISOString(),
          p_session_ttl_ms: lockTtlMs,
          p_claim_grace_ms: lockTtlMs,
        },
      );
      if (lockError) throw new Error(lockError.message);

      const lock = lockRows?.[0];
      if (lock?.action === "reuse" && lock.checkout_url) {
        return NextResponse.json({ url: lock.checkout_url });
      }
      if (lock?.action === "wait") {
        throw new PaymentError(
          "A subscription checkout for this course is already starting. Please try again in a moment.",
          409,
        );
      }
      if (!lock || !["claim", "proceed"].includes(String(lock.action))) {
        throw new Error("Checkout lock returned an invalid action.");
      }

      let stripeCreateStarted = false;
      let subscriptionSession: Stripe.Checkout.Session | null = null;
      try {
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

        stripeCreateStarted = true;
        subscriptionSession = await stripe.checkout.sessions.create(
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
                ...(priced.offerId ? { offerId: priced.offerId } : {}),
                ...(priced.priceId ? { priceId: priced.priceId } : {}),
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
              ...(priced.offerId ? { offerId: priced.offerId } : {}),
              ...(priced.priceId ? { priceId: priced.priceId } : {}),
              ...(affiliateUserId ? { affiliateUserId } : {}),
            },
            expires_at: Math.floor(Date.now() / 1000) + checkoutSessionExpiresInSec,
            success_url: `${appUrl}/learn/courses/${encodeURIComponent(courseId)}?checkout=success`,
            cancel_url: `${appUrl}/courses/${encodeURIComponent(courseId)}?checkout=cancelled`,
          },
          { idempotencyKey: `course_sub_checkout_${checkoutAttemptId}` },
        );

        if (!subscriptionSession.url) {
          throw new Error("Stripe did not return a Checkout URL.");
        }

        const { data: publishedLock, error: publishLockError } = await admin
          .from("checkout_locks")
          .update({
            checkout_url: subscriptionSession.url,
            order_id: checkoutAttemptId,
            checkout_session_id: subscriptionSession.id,
            updated_at: new Date().toISOString(),
          })
          .eq("lock_key", lockKey)
          .eq("order_id", checkoutAttemptId)
          .select("lock_key")
          .maybeSingle();
        if (publishLockError) throw new Error(publishLockError.message);
        if (!publishedLock) {
          throw new Error("Checkout lock disappeared before the session was published.");
        }

        return NextResponse.json({ url: subscriptionSession.url });
      } catch (error) {
        let lockCanBeReleased = !stripeCreateStarted;
        if (subscriptionSession?.id) {
          try {
            await stripe.checkout.sessions.expire(subscriptionSession.id);
            lockCanBeReleased = true;
          } catch (expireError) {
            lockCanBeReleased = false;
            console.error("[checkout/subscription-expire]", expireError);
          }
        }
        if (lockCanBeReleased) {
          const { error: releaseLockError } = await admin
            .from("checkout_locks")
            .delete()
            .eq("lock_key", lockKey)
            .eq("order_id", checkoutAttemptId);
          if (releaseLockError) {
            console.error("[checkout/subscription-lock-release]", releaseLockError.message);
          }
        }
        throw error;
      }
    }

    // --- One-time checkout with the B3 in-flight lock ----------------------
    // The lock (claim_checkout_lock RPC) is claimed AFTER all validation so a
    // rejected request never holds it. The session below expires in 31 min; the
    // lock's session TTL sits a few minutes past it so a takeover never races a
    // still-payable session.
    const checkoutSessionExpiresInSec = 31 * 60;
    const nowIso = new Date().toISOString();
    const orderId = crypto.randomUUID();
    const lockKey = `${userId}__${courseId}`;

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
      const { data: existingLock, error: existingLockError } = await admin
        .from("checkout_locks")
        .select("order_id")
        .eq("lock_key", lockKey)
        .maybeSingle();
      if (existingLockError) throw new Error(existingLockError.message);

      const { data: existingOrder, error: existingOrderError } = existingLock?.order_id
        ? await admin
            .from("orders")
            .select("offer_id,price_id")
            .eq("id", existingLock.order_id)
            .maybeSingle()
        : { data: null, error: null };
      if (existingOrderError) throw new Error(existingOrderError.message);
      if (
        !existingOrder
        || (existingOrder.offer_id ?? null) !== (priced.offerId ?? null)
        || (existingOrder.price_id ?? null) !== (priced.priceId ?? null)
      ) {
        throw new PaymentError(
          "Another offer already has an active checkout. Close it or wait for it to expire before switching offers.",
          409,
        );
      }

      return NextResponse.json({ url: lock.checkout_url });
    }
    if (lock?.action === "wait") {
      throw new PaymentError(
        "A checkout for this course is already starting. Please try again in a moment.",
        409,
      );
    }
    if (!lock || !["claim", "proceed"].includes(String(lock.action))) {
      throw new Error("Checkout lock returned an invalid action.");
    }

    if (appliedCouponId) {
      const { error: reservationError } = await admin.rpc(
        "reserve_course_coupon",
        {
          p_coupon_id: appliedCouponId,
          p_order_id: orderId,
          p_user_id: userId,
          p_expires_at: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        },
      );
      if (reservationError) {
        const message = String(reservationError.message ?? "");
        if (message.includes("COUPON_LIMIT_REACHED")) {
          throw new PaymentError("This coupon has reached its redemption limit.");
        }
        if (message.includes("COUPON_EXPIRED")) {
          throw new PaymentError("This coupon has expired.");
        }
        throw new PaymentError("This coupon is no longer available.");
      }
      releasableCouponReservation = { admin, orderId };
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
      offer_id: priced.offerId ?? null,
      price_id: priced.priceId ?? null,
      coupon_code: appliedCouponCode,
      discount_minor: discountMinor,
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

    const stripeAccountCountry = course.installments_enabled
      && currency.toUpperCase() === "MXN"
      ? await getStripePlatformAccountCountry(stripe)
      : null;
    const installmentPlan = buildInstallmentPlan({
      amountMinor,
      installmentsEnabled: Boolean(course.installments_enabled),
      installmentsMax: course.installments_max,
      currency,
      stripeAccountCountry,
    });
    // Stripe card installments require a Mexico platform account and MXN. Card
    // issuer and amount eligibility remain Stripe's responsibility at Checkout.
    const enableStripeCardInstallments =
      installmentPlan.enabled && installmentPlan.stripeCardInstallmentsEligible;

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
        ...(priced.offerId ? { offerId: priced.offerId } : {}),
        ...(priced.priceId ? { priceId: priced.priceId } : {}),
        ...(installmentPlan.enabled
          ? {
              installmentsEnabled: "1",
              installmentsMax: String(installmentPlan.maxCount),
            }
          : {}),
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
          ...(priced.offerId ? { offerId: priced.offerId } : {}),
          ...(priced.priceId ? { priceId: priced.priceId } : {}),
          ...(appliedCouponCode ? { couponCode: appliedCouponCode } : {}),
          ...(affiliateUserId ? { affiliateUserId } : {}),
          ...(installmentPlan.enabled
            ? { installmentsMax: String(installmentPlan.maxCount) }
            : {}),
        },
        ...(enableStripeCardInstallments
          ? {
              payment_method_options: {
                card: {
                  installments: { enabled: true },
                },
              },
            }
          : {}),
      },
      expires_at: Math.floor(Date.now() / 1000) + checkoutSessionExpiresInSec,
      success_url: `${appUrl}/learn/courses/${encodeURIComponent(courseId)}?checkout=success`,
      cancel_url: `${appUrl}/courses/${encodeURIComponent(courseId)}?checkout=cancelled`,
    };

    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: `checkout_${orderId}`,
    });
    releasableCouponReservation = null;

    const { error: orderSessionError } = await admin
      .from("orders")
      .update({ checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq("id", orderId);
    if (orderSessionError) {
      throw new Error(orderSessionError.message);
    }

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL.");
    }

    // Publish the live session on the lock so a concurrent sibling reuses THIS
    // url instead of opening a second charge. [B3]
    const { data: publishedLock, error: publishLockError } = await admin
      .from("checkout_locks")
      .update({
        checkout_url: session.url,
        order_id: orderId,
        checkout_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq("lock_key", lockKey)
      .select("lock_key")
      .maybeSingle();
    if (publishLockError) {
      throw new Error(publishLockError.message);
    }
    if (!publishedLock) {
      throw new Error("Checkout lock disappeared before the session was published.");
    }

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (releasableCouponReservation) {
      const { error: releaseError } = await releasableCouponReservation.admin
        .rpc("release_course_coupon_reservation", {
          p_order_id: releasableCouponReservation.orderId,
        });
      if (releaseError) {
        console.error("[checkout/coupon-release]", releaseError.message);
      }
    }
    return paymentErrorResponse(error);
  }
}
