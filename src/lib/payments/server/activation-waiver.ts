import { ACTIVATION_FEE_CHECKOUT_PURPOSE } from "@/data/plans";
import { PaymentError } from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getUserRow } from "@/lib/payments/server/stripe-helpers";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function finishActivationWaiver(uid: string, revision: string): Promise<void> {
  try {
    if (!uid || uid.trim() !== uid || !revision || revision.trim() !== revision) throw new Error();
    const profile = await getUserRow(uid);
    if (!profile || profile.uid !== uid) throw new Error();
    const customerId = profile.stripe_customer_id;

    if (customerId !== null) {
      if (typeof customerId !== "string" || !customerId || customerId.trim() !== customerId) throw new Error();
      const stripe = getStripeClient();
      const cursors = new Set<string>();
      let startingAfter: string | undefined;
      do {
        // No connected-account options: activation fees belong to the platform.
        const page = await stripe.checkout.sessions.list({
          customer: customerId, limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        if (!Array.isArray(page.data) || typeof page.has_more !== "boolean") throw new Error();
        const nextCursor = page.has_more ? page.data.at(-1)?.id : undefined;
        if (page.has_more) {
          if (typeof nextCursor !== "string" || !nextCursor || nextCursor.trim() !== nextCursor || cursors.has(nextCursor)) throw new Error();
          cursors.add(nextCursor);
        }

        for (const session of page.data) {
          if (!session || typeof session !== "object") throw new Error();
          if (session.metadata?.uid !== uid || session.metadata?.purpose !== ACTIVATION_FEE_CHECKOUT_PURPOSE) continue;
          const sessionCustomer = typeof session.customer === "string" ? session.customer : session.customer?.id;
          if (sessionCustomer !== customerId || typeof session.id !== "string" || !session.id || session.id.trim() !== session.id) throw new Error();
          if (session.status === "expired" || session.status === "complete") continue;
          if (session.status !== "open") throw new Error();
          let expired;
          try {
            expired = await stripe.checkout.sessions.expire(session.id);
          } catch {
            // Another cleanup may have expired it; completed payments are not equivalent.
            expired = await stripe.checkout.sessions.retrieve(session.id);
          }
          if (expired.id !== session.id || expired.status !== "expired") throw new Error();
        }
        startingAfter = nextCursor;
      } while (startingAfter !== undefined);
    }

    const { data, error } = await getSupabaseAdminClient().rpc("finalize_creator_activation_waiver", {
      p_target_uid: uid, p_revision: revision,
    });
    if (error || data !== true) throw new Error();
  } catch {
    throw new PaymentError("Could not complete the activation waiver. Please try again.", 503);
  }
}
