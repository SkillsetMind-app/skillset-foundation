import type { User } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/payments/server/app-url";
import type { getSupabaseAdminClient } from "@/lib/supabase/admin";

// The passwordless sign-in link guest checkout buyers get. Kept apart from the
// rest of the guest checkout code so the Stripe webhook can send it without
// pulling in the checkout route's dependencies.

type Admin = ReturnType<typeof getSupabaseAdminClient>;

/** Marks accounts guest checkout created (user_metadata, and app_metadata, which only the server writes). */
export const GUEST_CHECKOUT_ORIGIN = "guest_checkout";

/**
 * Sign-in link to the course, same mechanism as the creator's manual access
 * (admin signInWithOtp). Never creates an account. Returns whether the
 * provider accepted it; the caller decides what the person is told.
 */
export async function sendGuestAccessLink(admin: Admin, email: string, courseId: string): Promise<boolean> {
  const next = `/learn/courses/${encodeURIComponent(courseId)}`;
  try {
    const { error } = await admin.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${getAppUrl()}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      console.error("[guest-checkout] access link not sent", { status: error.status ?? null, code: error.code ?? null });
    }
    return !error;
  } catch {
    return false;
  }
}

/**
 * After a paid sale: an account guest checkout created that has not confirmed
 * its e-mail has no password, so the purchase email's plain course link leads
 * to a sign-in it cannot complete. Such a buyer also gets the sign-in link.
 * Every other account gets nothing more. Never throws; a failed send is logged.
 */
export async function sendGuestSignInLinkAfterPurchase(
  admin: Admin,
  buyer: Pick<User, "id" | "email" | "email_confirmed_at" | "app_metadata"> | null,
  courseId: string,
): Promise<void> {
  if (!buyer?.email || buyer.app_metadata?.created_via !== GUEST_CHECKOUT_ORIGIN || buyer.email_confirmed_at) return;
  if (!(await sendGuestAccessLink(admin, buyer.email, courseId))) {
    console.error("Guest checkout sign-in link failed after a paid sale", { courseId, userId: buyer.id });
  }
}
