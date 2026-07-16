import { NextResponse } from "next/server";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { createFreshConnectedAccount, getUserRow } from "@/lib/payments/server/stripe-helpers";
import {
  isConnectNotEnabledError,
  runWithOrphanedAccountSelfHeal,
} from "@/lib/payments/connect-self-heal";

// Ported from Firebase callable createConnectAccountSession
// (functions/src/index.ts). Mints a Stripe Connect Account Session
// client_secret for the embedded account-onboarding component.
export async function POST() {
  try {
    const uid = await requireUserId();

    await enforceRateLimit(`connect_session_${uid}`, 30, 3600000);

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
        // ponytail: dropped analytics (captureServerEvent TEACHER_KYC_SUBMITTED)
      }

      // effectiveAccountId captures whichever id the self-heal finally used so
      // the response carries the correct (possibly recreated) account id.
      let effectiveAccountId = accountId;
      const accountSession = await runWithOrphanedAccountSelfHeal({
        accountId,
        runOp: (acct) => {
          effectiveAccountId = acct;
          return stripe.accountSessions.create({
            account: acct,
            components: {
              account_onboarding: { enabled: true },
            },
          });
        },
        recreateAccount: () => createFreshConnectedAccount({ uid, email, stripe }),
        onRecreate: () => {},
      });

      return NextResponse.json({
        clientSecret: accountSession.client_secret,
        accountId: effectiveAccountId,
      });
    } catch (error) {
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
