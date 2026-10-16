import { randomBytes } from "node:crypto";

import type { User } from "@supabase/supabase-js";

import { notifyOps } from "@/lib/ops/alert";
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
 * A random password the project's Auth password rules always accept: 256 random
 * bits (base64url) plus one lowercase letter, one uppercase letter, one digit
 * and one symbol, since the rules require all four classes and base64url
 * alone does not always carry a symbol. Nobody is meant to know it; access
 * goes by e-mail link or password recovery.
 */
export function randomStrongPassword(): string {
  return `${randomBytes(32).toString("base64url")}aA1!`;
}

/** app_metadata mark: the paid guest checkout sale replaced this account's password. */
export const PAID_GUEST_RESET_MARK = "guest_password_reset_at";

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
 * A sign-in link that did not go out, for operations. Ids only: never the
 * buyer's address. `where` names the caller: the paid-sale webhook or one of
 * the guest checkout routes.
 */
export function reportLostSignInLink(
  where: "stripe.webhook" | "guest_checkout",
  courseId: string,
  userId: string,
  result: string,
): void {
  console.error("Guest checkout sign-in link not sent", { where, courseId, userId, result });
  notifyOps({
    event: `${where}.guest_sign_in_link_failed`,
    severity: "warn",
    summary: result === "password_not_replaced"
      ? "An unconfirmed account made outside guest checkout holds this course, but its password could not be replaced, so no sign-in link went out. Replace the account's password by hand, or point the buyer to password recovery."
      : "A guest checkout buyer has the course but the sign-in link did not go out. They can use the resend on the thank-you page or password recovery.",
    context: { courseId, userId, result },
  });
}

/**
 * Before any sign-in link goes to it: an account made some other way (not by
 * guest checkout) that never confirmed its e-mail, and was not through this
 * yet, gets a new random password, marked in app_metadata. The address is still
 * unproven, so access goes by the link. Every other account is left as it is.
 */
export async function secureForeignUnconfirmedAccount(
  admin: Admin,
  account: Pick<User, "id" | "email_confirmed_at" | "app_metadata">,
): Promise<"ok" | "failed"> {
  const meta = account.app_metadata ?? {};
  if (account.email_confirmed_at || meta.created_via === GUEST_CHECKOUT_ORIGIN || meta[PAID_GUEST_RESET_MARK]) return "ok";
  try {
    const { error } = await admin.auth.admin.updateUserById(account.id, {
      password: randomStrongPassword(),
      app_metadata: { [PAID_GUEST_RESET_MARK]: new Date().toISOString() },
    });
    return error ? "failed" : "ok";
  } catch {
    return "failed";
  }
}

/**
 * After every paid sale, from the Stripe webhook, once the course is unlocked:
 * - an account guest checkout created gets the sign-in link (it may have no
 *   password, so the purchase email's plain course link can lead nowhere);
 * - a sale that came through guest checkout (checkout_origin "guest") to an
 *   account made some other way that never confirmed its e-mail goes through
 *   secureForeignUnconfirmedAccount first, then gets the sign-in link.
 * Every other account gets nothing more. Never throws and never undoes the
 * sale: a failure is logged and reported to operations with ids only.
 */
export async function sendGuestSignInLinkAfterPurchase(
  admin: Admin,
  buyer: Pick<User, "id" | "email" | "email_confirmed_at" | "app_metadata"> | null,
  courseId: string,
  fromGuestCheckout = false,
): Promise<void> {
  if (!buyer?.email) return;
  const guestAccount = buyer.app_metadata?.created_via === GUEST_CHECKOUT_ORIGIN;
  if (!guestAccount && (!fromGuestCheckout || buyer.email_confirmed_at)) return;
  if ((await secureForeignUnconfirmedAccount(admin, buyer)) === "failed") {
    reportLostSignInLink("stripe.webhook", courseId, buyer.id, "password_not_replaced");
    return;
  }
  const result = await sendGuestAccessLink(admin, buyer.email, courseId);
  if (result !== "sent") reportLostSignInLink("stripe.webhook", courseId, buyer.id, result);
}
