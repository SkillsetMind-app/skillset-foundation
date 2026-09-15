import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type PurchaseAccessEmail = {
  /** The buyer's account email: the magic link signs into exactly this account. */
  email: string;
  /** Absolute classroom URL of the course that was just bought. */
  courseUrl: string;
};

/**
 * Sends the buyer one email whose button signs them in and opens the course.
 *
 * Same channel as platform invitations and creator course access: Supabase
 * Auth's Magic Link email, sent through the project's custom SMTP. No new
 * provider, no key in this app. The link goes through /auth/confirm, which
 * verifies the one-time token on any device and then lands on `next`.
 *
 * ponytail: the Magic Link template is one fixed body per project, so the
 * course title and a Spanish variant cannot be rendered per purchase. The link
 * lands on the course page, which names the course. Rendering both needs a
 * transactional mail provider.
 *
 * Throws when Supabase refuses the send, so the caller can log and alert.
 */
export async function sendPurchaseAccessEmail({ email, courseUrl }: PurchaseAccessEmail): Promise<void> {
  const course = new URL(courseUrl);
  const { error } = await getSupabaseAdminClient().auth.signInWithOtp({
    email,
    options: {
      // A buyer always has an account: checkout requires a signed-in user.
      shouldCreateUser: false,
      emailRedirectTo: `${course.origin}/auth/confirm?next=${encodeURIComponent(course.pathname)}`,
    },
  });
  if (error) throw new Error(`Purchase access email was not sent: ${error.message}`);
}
