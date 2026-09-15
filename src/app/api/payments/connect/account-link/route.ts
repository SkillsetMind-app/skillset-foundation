import { NextResponse } from "next/server";

import {
  assertCreatorActivated,
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
import { isConnectPayoutCountry } from "@/lib/payments/connect-countries";

// Ported from Firebase callable createTeacherStripeAccountLink
// (functions/src/index.ts). Mints a Stripe Connect account-onboarding link for
// a teacher, self-healing an orphaned connected account once.
export async function POST(request: Request) {
  try {
    const uid = await requireUserId();

    await enforceRateLimit(`stripe_onboarding_${uid}`, 10, 3600000);

    const body = (await request.json().catch(() => null)) as { country?: unknown } | null;

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

    // Same gate as the courses trigger: an unpaid creator must not be able to
    // mint a Stripe connected account.
    await assertCreatorActivated();

    const storedAccountId = user.stripe_connected_account_id || null;
    // The client's country only chooses the FIRST account. Once one exists, the
    // stored country wins (a heal must not move a creator to another country).
    const requestedCountry = typeof body?.country === "string" ? body.country.toUpperCase() : "";
    if (!storedAccountId && !isConnectPayoutCountry(requestedCountry)) {
      throw new PaymentError(
        "Payouts are not available in that country yet.",
        400,
        "unsupported_country",
      );
    }
    const country = storedAccountId ? user.stripe_connect_country ?? "US" : requestedCountry;

    try {
      const stripe = getStripeClient();
      const email = user.email || undefined;
      let accountId = storedAccountId;

      if (!accountId) {
        accountId = await createFreshConnectedAccount({ uid, email, stripe, country });
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
        recreateAccount: () =>
          createFreshConnectedAccount({
            uid,
            email,
            stripe,
            replacingAccountId: accountId,
            country,
          }),
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
