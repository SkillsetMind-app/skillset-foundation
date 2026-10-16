import type { User } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/payments/server/app-url";
import type { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { runRateLimit } from "@/lib/supabase/rate-limit";

// The passwordless sign-in link guest checkout buyers get. Kept apart from the
// rest of the guest checkout code so the Stripe webhook can send it without
// pulling in the checkout route's dependencies.

type Admin = ReturnType<typeof getSupabaseAdminClient>;

/** Marks accounts guest checkout created (user_metadata, and app_metadata, which only the server writes). */
export const GUEST_CHECKOUT_ORIGIN = "guest_checkout";

// One platform-wide ceiling for every Auth e-mail guest checkout sends (the
// checkout route, the thank-you resend and the paid-sale webhook), kept under
// the project's Auth e-mail quota (300 an hour).
const AUTH_EMAIL_KEY = "guest_auth_email_global";
const AUTH_EMAIL_PER_HOUR = 200;
const HOUR_MS = 60 * 60 * 1000;

export type GuestAccessLinkResult = "sent" | "limited" | "failed";

/**
 * Sign-in link to the course, same mechanism as the creator's manual access
 * (admin signInWithOtp). Never creates an account. Counts against the shared
 * ceiling right before sending; over it, or with the limiter down, nothing is
 * sent. The caller decides what the person is told.
 */
export async function sendGuestAccessLink(admin: Admin, email: string, courseId: string): Promise<GuestAccessLinkResult> {
  const next = `/learn/courses/${encodeURIComponent(courseId)}`;
  try {
    const { error: limitError } = await runRateLimit(AUTH_EMAIL_KEY, AUTH_EMAIL_PER_HOUR, HOUR_MS);
    if (limitError) {
      if (limitError.message?.includes("RATE_LIMIT")) return "limited";
      console.error("[guest-checkout] access link not sent: rate limiter unavailable");
      return "failed";
    }
    const { error } = await admin.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${getAppUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      console.error("[guest-checkout] access link not sent", { status: error.status ?? null, code: error.code ?? null });
      return "failed";
    }
    return "sent";
  } catch {
    return "failed";
  }
}

/**
 * After every paid sale to an account guest checkout created: it may have no
 * password (confirmed or not, a later purchase can come from a new browser),
 * so the purchase email's plain course link can lead to a sign-in it cannot
 * complete. Such a buyer also gets the sign-in link, once per sale. Every
 * other account gets nothing more. Never throws; a failed send is logged.
 */
export async function sendGuestSignInLinkAfterPurchase(
  admin: Admin,
  buyer: Pick<User, "id" | "email" | "app_metadata"> | null,
  courseId: string,
): Promise<void> {
  if (!buyer?.email || buyer.app_metadata?.created_via !== GUEST_CHECKOUT_ORIGIN) return;
  if ((await sendGuestAccessLink(admin, buyer.email, courseId)) !== "sent") {
    console.error("Guest checkout sign-in link failed after a paid sale", { courseId, userId: buyer.id });
  }
}
