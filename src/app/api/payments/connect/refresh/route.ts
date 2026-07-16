import { NextResponse } from "next/server";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getUserRow } from "@/lib/payments/server/stripe-helpers";
import {
  isConnectNotEnabledError,
  isUnusableConnectedAccountError,
} from "@/lib/payments/connect-self-heal";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// Ported from Firebase callable refreshTeacherStripeAccount
// (functions/src/index.ts). Retrieves the connected account and reconciles the
// stored KYC/readiness flags, self-classifying platform gaps vs unusable ids.
export async function POST() {
  try {
    const uid = await requireUserId();

    await enforceRateLimit(`connect_refresh_${uid}`, 20, 3600000);

    const user = await getUserRow(uid);
    if (!user) {
      throw new PaymentError("User profile not found.", 400);
    }

    const accountId = user.stripe_connected_account_id;
    if (!accountId) {
      return NextResponse.json({
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      });
    }

    const admin = getSupabaseAdminClient();
    const now = new Date().toISOString();

    try {
      const account = await getStripeClient().accounts.retrieve(accountId);
      const status =
        account.charges_enabled && account.payouts_enabled ? "ready" : "onboarding_required";

      const { error } = await admin
        .from("users")
        .update({
          stripe_connect_status: status,
          stripe_connect_charges_enabled: Boolean(account.charges_enabled),
          stripe_connect_payouts_enabled: Boolean(account.payouts_enabled),
          stripe_connect_updated_at: now,
          updated_at: now,
        })
        .eq("uid", uid);
      if (error) throw new Error(error.message);

      // ponytail: dropped analytics (captureServerEvent TEACHER_KYC_APPROVED)

      return NextResponse.json({
        connected: true,
        chargesEnabled: Boolean(account.charges_enabled),
        payoutsEnabled: Boolean(account.payouts_enabled),
        status,
      });
    } catch (error) {
      if (isConnectNotEnabledError(error)) {
        const { error: updErr } = await admin
          .from("users")
          .update({
            stripe_connect_charges_enabled: false,
            stripe_connect_payouts_enabled: false,
            stripe_connect_updated_at: now,
            updated_at: now,
          })
          .eq("uid", uid);
        if (updErr) throw new Error(updErr.message);
        return NextResponse.json({
          connected: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          status: "onboarding_required",
          payoutsUnavailable: true,
        });
      }

      if (isUnusableConnectedAccountError(error)) {
        const { error: updErr } = await admin
          .from("users")
          .update({
            stripe_connected_account_id: null,
            stripe_connect_status: "disconnected",
            stripe_connect_charges_enabled: false,
            stripe_connect_payouts_enabled: false,
            stripe_connect_updated_at: now,
            updated_at: now,
          })
          .eq("uid", uid);
        if (updErr) throw new Error(updErr.message);
        return NextResponse.json({
          connected: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          status: "disconnected",
        });
      }

      throw error;
    }
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
