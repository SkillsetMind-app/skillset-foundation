import { NextResponse } from "next/server";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { createFreshConnectedAccount, getUserRow } from "@/lib/payments/server/stripe-helpers";
import {
  isConnectNotEnabledError,
  runWithOrphanedAccountSelfHeal,
} from "@/lib/payments/connect-self-heal";

// Ported from Firebase callable createTeacherStripeAccountLink
// (functions/src/index.ts). Mints a Stripe Connect account-onboarding link for
// a teacher, self-healing an orphaned connected account once.
export async function POST() {
  try {
    const uid = await requireUserId();

    await enforceRateLimit(`stripe_onboarding_${uid}`, 10, 3600000);

    const user = await getUserRow(uid);
    if (!user) {
      throw new PaymentError("User profile not found.", 400);
    }

    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.includes("teacher")) {
      throw new PaymentError(
        "Only teacher accounts can connect a payout account.",
        403,
        "permission_denied",
      );
    }

    try {
      const stripe = getStripeClient();
      const email = user.email || undefined;
      let accountId = user.stripe_connected_account_id || null;

      if (!accountId) {
        accountId = await createFreshConnectedAccount({ uid, email, stripe });
      }

      const appUrl = getAppUrl();
      const accountLink = await runWithOrphanedAccountSelfHeal({
        accountId,
        runOp: (acct) =>
          stripe.accountLinks.create({
            account: acct,
            refresh_url: `${appUrl}/account/payments?stripe=refresh#stripe-connect`,
            return_url: `${appUrl}/account/payments?stripe=return`,
            type: "account_onboarding",
          }),
        recreateAccount: () => createFreshConnectedAccount({ uid, email, stripe }),
        onRecreate: () => {},
      });

      return NextResponse.json({ url: accountLink.url });
    } catch (error) {
      // Port of toStripeHttpsError: only the connect-not-enabled case gets a
      // bespoke client code; everything else propagates unchanged.
      if (isConnectNotEnabledError(error)) {
        throw new PaymentError(
          "Payouts are being configured. Please try again soon.",
          400,
          "connect_not_enabled",
        );
      }
      throw error;
    }
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
