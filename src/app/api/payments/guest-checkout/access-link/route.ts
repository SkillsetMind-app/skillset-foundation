import { NextResponse, type NextRequest } from "next/server";

import { enforceRateLimit, PaymentError, paymentErrorResponse } from "@/lib/payments/server/auth";
import {
  decodeGuestCheckoutCookie,
  findAuthUserIdByEmail,
  GUEST_CHECKOUT_COOKIE,
  isGuestCheckoutConfigured,
  isPlatformRequest,
  sendGuestAccessLink,
} from "@/lib/payments/server/guest-checkout";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimitKeyFromIp, rateLimitKeyFromValue } from "@/lib/supabase/rate-limit";

const HOUR_MS = 60 * 60 * 1000;
const PAYMENT_PENDING = {
  error: "Your payment is still being confirmed. Your link will be sent as soon as it is.",
  code: "payment_pending",
} as const;

// POST /api/payments/guest-checkout/access-link — resends the sign-in link
// from the thank-you page, once the paid sale has unlocked the course (the
// webhook already sent the first one). The address and course come only from
// the signed cookie this browser got at checkout; the request body is ignored.
export async function POST(request: NextRequest) {
  if (!isGuestCheckoutConfigured() || !isPlatformRequest(request)) {
    return NextResponse.json({ error: "Not found.", code: "guest_checkout_disabled" }, { status: 404 });
  }
  const pending = decodeGuestCheckoutCookie(request.cookies.get(GUEST_CHECKOUT_COOKIE)?.value);
  if (!pending) {
    return NextResponse.json({ error: "No recent checkout.", code: "no_pending_checkout" }, { status: 404 });
  }

  try {
    await enforceRateLimit(rateLimitKeyFromIp(request, "guest_access_link_ip"), 10, HOUR_MS);
    await enforceRateLimit(rateLimitKeyFromValue("guest_access_link_email", pending.email), 3, HOUR_MS);
    const admin = getSupabaseAdminClient();
    // Only after the webhook unlocked the course for this account.
    const userId = await findAuthUserIdByEmail(admin, pending.email);
    if (!userId) return NextResponse.json(PAYMENT_PENDING, { status: 409 });
    const { data: enrollment, error: enrollmentError } = await admin
      .from("enrollments")
      .select("status")
      .eq("id", `${userId}__${pending.courseId}`)
      .maybeSingle();
    if (enrollmentError) throw new Error(enrollmentError.message);
    if (!["active", "completed"].includes(String(enrollment?.status))) {
      return NextResponse.json(PAYMENT_PENDING, { status: 409 });
    }
    // The platform-wide ceiling is counted inside sendGuestAccessLink.
    const result = await sendGuestAccessLink(admin, pending.email, pending.courseId);
    if (result === "limited") throw new PaymentError("Too many attempts. Please wait before trying again.", 429);
    return result === "sent"
      ? NextResponse.json({ status: "sent" })
      : NextResponse.json({ error: "The link could not be sent. Please try again.", code: "send_failed" }, { status: 502 });
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
