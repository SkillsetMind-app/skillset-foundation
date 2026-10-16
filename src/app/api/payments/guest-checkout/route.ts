import { NextResponse } from "next/server";

import { isCoursePubliclySellable } from "@/domain/teacher-course";
import { getServerLocale } from "@/lib/i18n/server";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { enforceRateLimit, PaymentError, paymentErrorResponse } from "@/lib/payments/server/auth";
import { createCourseCheckoutSession } from "@/lib/payments/server/course-checkout";
import {
  discardNewGuestBuyer,
  encodeGuestCheckoutCookie,
  findOrCreateGuestBuyer,
  GUEST_CHECKOUT_COOKIE,
  guestCheckoutCookieOptions,
  isGuestCheckoutConfigured,
  sendGuestAccessLink,
  verifyTurnstileToken,
} from "@/lib/payments/server/guest-checkout";
import { getCourseRow } from "@/lib/payments/server/stripe-helpers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimitKeyFromIp, rateLimitKeyFromValue } from "@/lib/supabase/rate-limit";

const HOUR_MS = 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCESS_LINK_SENT = { status: "access_link_sent" } as const;

function invalidRequest() {
  return new PaymentError("Check your name, e-mail and the terms box.", 400, "invalid_request");
}

// POST /api/payments/guest-checkout — buy a paid course without signing in.
// { courseId, offerId?, offerCode?, priceId?, couponCode?, name, email,
//   acceptTerms: true, captchaToken }
//
// The account for the e-mail is found in auth.users or created silently (no
// password, no e-mail, no session), and the SAME session as the signed-in
// route is opened for it, so price, coupon, fee, order row and the webhook are
// unchanged. Nobody is signed in here: access comes by e-mail.
//
// The answer is the same whether or not the e-mail already had an account: a
// Stripe url, or { status: "access_link_sent" } when that account has nothing
// to buy here (it holds the course, owns it, or has a checkout open).
export async function POST(request: Request) {
  if (!isGuestCheckoutConfigured()) {
    return NextResponse.json({ error: "Not found.", code: "guest_checkout_disabled" }, { status: 404 });
  }

  try {
    const text = await request.text();
    if (text.length > 4096) throw invalidRequest();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      throw invalidRequest();
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidRequest();

    const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const captchaToken = typeof body.captchaToken === "string" ? body.captchaToken : "";
    if (
      !courseId || courseId.length > 160
      || !name || name.length > 80
      || email.length > 254 || !EMAIL_PATTERN.test(email)
      || body.acceptTerms !== true
      || !captchaToken || captchaToken.length > 2048
    ) {
      throw invalidRequest();
    }

    // Both limits fail closed. Per IP before the CAPTCHA call, per e-mail after.
    await enforceRateLimit(rateLimitKeyFromIp(request, "guest_checkout_ip"), 5, HOUR_MS);
    if (!(await verifyTurnstileToken(captchaToken, request.headers.get("x-real-ip")))) {
      throw new PaymentError("The security check failed. Please try again.", 400, "captcha_failed");
    }
    await enforceRateLimit(rateLimitKeyFromValue("guest_checkout_email", email), 3, HOUR_MS);

    // No account is made for a course that cannot be bought.
    const course = await getCourseRow(courseId);
    if (!course) throw new PaymentError("Course not found.", 404);
    if (!isCoursePubliclySellable(course.status)) {
      throw new PaymentError("This course is not available for purchase right now.");
    }

    const admin = getSupabaseAdminClient();
    const buyer = await findOrCreateGuestBuyer(admin, {
      email,
      name,
      locale: await getServerLocale(),
    });

    // An account made here exists only for a purchase that goes ahead: any
    // other outcome removes it. The answer to the browser stays the same.
    let response: NextResponse;
    try {
      response = await answerForBuyer(admin, { userId: buyer.userId, courseId, ownerId: course.owner_id, email, body });
    } catch (error) {
      if (buyer.created) await discardNewGuestBuyer(admin, buyer.userId);
      throw error;
    }
    if (buyer.created && !response.ok) await discardNewGuestBuyer(admin, buyer.userId);
    return response;
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

async function answerForBuyer(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  input: { userId: string; courseId: string; ownerId: string; email: string; body: Record<string, unknown> },
): Promise<NextResponse> {
  const { userId, courseId, email, body } = input;
  const { data: enrollment, error: enrollmentError } = await admin
    .from("enrollments")
    .select("status")
    .eq("id", `${userId}__${courseId}`)
    .maybeSingle();
  if (enrollmentError) throw new Error(enrollmentError.message);
  if (input.ownerId === userId || ["active", "completed"].includes(String(enrollment?.status))) {
    await sendGuestAccessLink(admin, email, courseId);
    return NextResponse.json(ACCESS_LINK_SENT);
  }

  const response = await createCourseCheckoutSession(
    userId,
    {
      courseId,
      couponCode: body.couponCode,
      offerId: body.offerId,
      offerCode: body.offerCode,
      priceId: body.priceId,
    },
    {
      // Not the classroom: the buyer is not signed in.
      successUrl: `${getAppUrl()}/checkout/thanks?course=${encodeURIComponent(courseId)}`,
      // The address typed here, which found the account. Never the profile
      // email, which the account's owner can change.
      customerEmail: email,
    },
  );

  // 409: this account already has a subscription or a checkout open for the
  // course. Same answer as an existing enrollment above.
  if (response.status === 409) {
    await sendGuestAccessLink(admin, email, courseId);
    return NextResponse.json(ACCESS_LINK_SENT);
  }
  if (response.ok) {
    response.cookies.set(
      GUEST_CHECKOUT_COOKIE,
      encodeGuestCheckoutCookie({ email, courseId }),
      guestCheckoutCookieOptions(),
    );
  }
  return response;
}
