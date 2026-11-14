import { NextResponse } from "next/server";

import {
  enforceRateLimit,
  PaymentError,
  paymentErrorResponse,
  requireUserId,
} from "@/lib/payments/server/auth";
import { getStripeClient } from "@/lib/payments/server/stripe";
import { getUserRow } from "@/lib/payments/server/stripe-helpers";

const STRIPE_FULL_DASHBOARD_URL = "https://dashboard.stripe.com/";

export async function POST() {
  let response: NextResponse;
  try {
    // O cliente de sessao ja exige conta ativa e MFA quando cadastrado.
    const uid = await requireUserId();
    await enforceRateLimit(`connect_login_${uid}`, 10, 3600000);

    const user = await getUserRow(uid);
    if (!user || !Array.isArray(user.roles) || !user.roles.includes("teacher")) {
      throw new PaymentError("Teacher access is required.", 403, "permission_denied");
    }
    if (!user.stripe_connected_account_id) {
      throw new PaymentError("Set up your payout account first.", 409, "connect_required");
    }

    // Conta com painel completo entra com o proprio login da Stripe; o link de
    // uso unico so existe para Express. Nao recriar conta em falha.
    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(user.stripe_connected_account_id);
    if (account.controller?.stripe_dashboard?.type === "full") {
      response = NextResponse.json({ url: STRIPE_FULL_DASHBOARD_URL });
    } else {
      const { url } = await stripe.accounts.createLoginLink(user.stripe_connected_account_id);
      response = NextResponse.json({ url });
    }
  } catch (error) {
    // O handler generico registra erros desconhecidos: nunca lhe passar dados Stripe.
    response = paymentErrorResponse(error instanceof PaymentError ? error : new PaymentError(
      "We could not open Stripe. Try again or contact support.",
      502,
      "stripe_dashboard_unavailable",
    ));
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
