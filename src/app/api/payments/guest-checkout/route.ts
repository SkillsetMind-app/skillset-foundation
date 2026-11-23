import { type NextRequest, NextResponse } from "next/server";

import { isCoursePubliclySellable } from "@/domain/teacher-course";
import { getServerLocale } from "@/lib/i18n/server";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { enforceRateLimit, PaymentError, paymentErrorResponse } from "@/lib/payments/server/auth";
import { createCourseCheckoutSession } from "@/lib/payments/server/course-checkout";
import {
  decodeGuestCheckoutCookie,
  discardNewGuestBuyer,
  encodeGuestCheckoutCookie,
  findOrCreateGuestBuyer,
  GUEST_CHECKOUT_COOKIE,
  guestCheckoutCookieOptions,
  isBuyerAccountBlocked,
  isGuestCheckoutConfigured,
  isPlatformRequest,
  reportLostSignInLink,
  secureForeignUnconfirmedAccount,
  sendGuestAccessLink,
  verifyTurnstileToken,
} from "@/lib/payments/server/guest-checkout";
import { getCourseRow } from "@/lib/payments/server/stripe-helpers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimitKeyFromIp, rateLimitKeyFromValue } from "@/lib/supabase/rate-limit";

const HOUR_MS = 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCESS_LINK_SENT = { status: "access_link_sent" } as const;
const SEND_FAILED = { error: "The link could not be sent. Please try again.", code: "send_failed" } as const;
const REFUSED_BEFORE_SESSION = new Set([400, 404, 422]);
const CHECKOUT_PENDING = {
  error: "You have a payment in progress for this course. Finish it or try again in a few minutes.",
  code: "checkout_pending",
} as const;
// The shared builder's 409s that mean the account already has the course.
const HAS_ACCESS_CONFLICTS = new Set([
  "This course is already attached to your learning workspace.",
  "You already have a subscription for this course.",
]);

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
// Stripe url; { status: "access_link_sent" } when that account already holds
// the course (enrolled, subscribed or owner); or a 409 "checkout_pending" when
// a checkout for the course is already open or starting for it. An open
// checkout's url goes back only to the browser that opened it (signed cookie).
export async function POST(request: NextRequest) {
  if (!isGuestCheckoutConfigured() || !isPlatformRequest(request)) {
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
    // The platform-wide ceiling covers only the e-mails (sendGuestAccessLink):
    // a purchase that goes to Stripe sends none.
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

    // A suspended account gets the same answer as a course that cannot be
    // bought, before anything is sent or opened. A new account has no controls.
    if (!buyer.created && (await isBuyerAccountBlocked(admin, buyer.userId))) {
      throw new PaymentError("This course is not available for purchase right now.");
    }

    // An account made here is removed only when the purchase was refused
    // before any checkout could exist for it. The answer to the browser stays
    // the same either way.
    const pending = decodeGuestCheckoutCookie(request.cookies.get(GUEST_CHECKOUT_COOKIE)?.value);
    const openedHere = pending?.email === email && pending.courseId === courseId;
    let response: NextResponse;
    try {
      response = await answerForBuyer(admin, { userId: buyer.userId, courseId, ownerId: course.owner_id, email, body, openedHere });
    } catch (error) {
      // Thrown before the shared builder ran.
      if (buyer.created) await discardNewGuestBuyer(admin, buyer.userId);
      throw error;
    }
    // 400/404/422 are the builder's refusals, all decided before a session is
    // created. A 409 means a checkout for this account is open or starting
    // (maybe a sibling request from the same buyer), and a 5xx may follow a
    // created session: the account stays in both cases.
    if (buyer.created && REFUSED_BEFORE_SESSION.has(response.status)) {
      await discardNewGuestBuyer(admin, buyer.userId);
    }
    return response;
  } catch (error) {
    return paymentErrorResponse(error);
  }
}

async function answerForBuyer(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  input: { userId: string; courseId: string; ownerId: string; email: string; body: Record<string, unknown>; openedHere: boolean },
): Promise<NextResponse> {
  const { userId, courseId, email, body } = input;
  const { data: enrollment, error: enrollmentError } = await admin
    .from("enrollments")
    .select("status")
    .eq("id", `${userId}__${courseId}`)
    .maybeSingle();
  if (enrollmentError) throw new Error(enrollmentError.message);
  if (input.ownerId === userId || ["active", "completed"].includes(String(enrollment?.status))) {
    return accessLinkAnswer(admin, userId, email, courseId);
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
      // Read by the webhook after the paid sale (sign-in link).
      checkoutOrigin: "guest",
      reuseOpenCheckout: input.openedHere,
    },
  );

  if (response.status === 409) {
    const conflict = (await response.json().catch(() => ({}))) as { error?: unknown };
    // The account already holds the course: same answer as an enrollment above.
    if (HAS_ACCESS_CONFLICTS.has(String(conflict.error))) {
      return accessLinkAnswer(admin, userId, email, courseId);
    }
    // A checkout already open or starting for the course (another offer, a
    // double submit): one answer for every such case, and no e-mail.
    return NextResponse.json(CHECKOUT_PENDING, { status: 409 });
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

// "Sent" only when the provider took the e-mail; otherwise a retryable error
// (429 when the shared Auth e-mail ceiling is reached).
async function accessLinkAnswer(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  userId: string,
  email: string,
  courseId: string,
): Promise<NextResponse> {
  // An unconfirmed account made some other way gets a new random password
  // before any link goes to it; if that fails, no link and a retryable answer.
  const { data: account, error: accountError } = await admin.auth.admin.getUserById(userId);
  if (accountError || !account?.user) return NextResponse.json(SEND_FAILED, { status: 502 });
  if ((await secureForeignUnconfirmedAccount(admin, account.user)) === "failed") {
    reportLostSignInLink("guest_checkout", courseId, userId, "password_not_replaced");
    return NextResponse.json(SEND_FAILED, { status: 502 });
  }
  const result = await sendGuestAccessLink(admin, email, courseId);
  if (result === "sent") return NextResponse.json(ACCESS_LINK_SENT);
  if (result === "limited") return paymentErrorResponse(new PaymentError("Too many attempts. Please wait before trying again.", 429));
  return NextResponse.json(SEND_FAILED, { status: 502 });
}
