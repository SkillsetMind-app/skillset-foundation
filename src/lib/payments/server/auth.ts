import { NextResponse } from "next/server";

import { plans } from "@/data/plans";
import { isPublicFeatureEnabled } from "@/lib/feature-flags";
import { notifyOps } from "@/lib/ops/alert";
import { StripeConfigError } from "@/lib/payments/server/stripe";
import { runRateLimit } from "@/lib/supabase/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Shared auth + error surface for the payment Route Handlers that replace the
// Firebase callables. Callables got the caller from `context.auth.uid` and threw
// `HttpsError` with user-facing messages; here we derive the uid from the
// request's Supabase session cookie and translate thrown errors to the same
// `{ error }` JSON shape the client already parses.

/**
 * Expected, user-facing failure (mirrors Firebase HttpsError). Its `message`
 * is surfaced VERBATIM to the client — the refund/policy flows depend on that,
 * so never put internal detail in it. `code` carries the machine-readable
 * `details.reason` the client branches on (e.g. "connect_not_enabled").
 */
export class PaymentError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "PaymentError";
    this.status = status;
    this.code = code;
  }
}

/** No valid session — the callable equivalent of `unauthenticated`. */
export class PaymentAuthError extends PaymentError {
  constructor(message = "You must be signed in.") {
    super(message, 401, "unauthenticated");
    this.name = "PaymentAuthError";
  }
}

/**
 * The signed-in user's id (== Firebase uid: `handle_new_user` sets
 * `users.uid = auth.users.id`, and enrollment ids are `${uid}__${courseId}`).
 * Throws PaymentAuthError when there is no valid session cookie.
 */
export async function requireUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new PaymentAuthError();
  }
  return data.user.id;
}

/**
 * Same as requireUserId but also asserts the platform-admin role via the
 * SECURITY DEFINER is_admin() RPC (reads the caller's users.roles). Used by the
 * admin refund route. Throws PaymentAuthError (403) for a signed-in non-admin.
 */
export async function requireAdminUserId(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new PaymentAuthError();
  }
  const { data: assurance, error: assuranceError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError || assurance?.currentLevel !== "aal2") {
    throw new PaymentError(
      "Two-factor authentication is required for administrative actions.",
      403,
      "mfa_required",
    );
  }
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error || !isAdmin) {
    // A signed-in account reaching an admin-only route is either a bug in our
    // own navigation or someone walking the API surface. Worth a look either
    // way; the throttle keeps a scripted sweep down to one message.
    notifyOps({
      event: "admin.route.denied",
      severity: "warn",
      summary:
        "A signed-in account without admin rights was refused at an admin-only route.",
    });
    throw new PaymentError("Admin privileges are required.", 403, "permission_denied");
  }
  return userData.user.id;
}

/**
 * Blocks creator-only actions until the one-time activation fee is paid.
 *
 * Delegates to the SECURITY DEFINER creator_activation_blocked() RPC rather than
 * reading users.activation_fee_paid_at here, so the flag lookup, the admin
 * exemption and the "flag is off" short-circuit stay defined in exactly one
 * place — the same predicate the courses trigger uses. A drift between the SQL
 * gate and a hand-rolled TS copy is how a paywall ends up half-open.
 *
 * Throws PaymentError(402, "activation_required"); callers surface it through
 * paymentErrorResponse like any other expected failure.
 */
export async function assertCreatorActivated(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: blocked, error } = await supabase.rpc("creator_activation_blocked");
  if (error) {
    throw new Error(error.message);
  }
  if (typeof blocked !== "boolean") throw new Error("Activation status unavailable.");
  if (blocked) {
    throw new PaymentError(
      "Pay the one-time activation fee to activate your creator account.",
      402,
      "activation_required",
    );
  }
}

/**
 * Shared rate-limit gate for the payment Route Handlers. Wraps the
 * service-role enforce_rate_limit RPC and throws PaymentError(429) on limit.
 * Single-sourcing it means a new route can't silently ship without a throttle —
 * which is exactly how connect/refresh went unprotected. `key` scopes the
 * bucket (convention: `${action}_${uid}`).
 */
export async function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const { error } = await runRateLimit(key, limit, windowMs);
  if (error) {
    if (error.message?.includes("RATE_LIMIT")) {
      throw new PaymentError("Too many attempts. Please wait before trying again.", 429);
    }
    throw new Error(error.message);
  }
}

/**
 * Whether the creator is on the Free plan, for the Free-plan daily caps (video
 * uploads, advisor, manual course access). Those caps follow the plan, never
 * require_activation_fee. Reads users.current_plan_id under the caller's own
 * session (users_select_self). Unknown, missing or unreadable counts as Free —
 * the stricter caps — the same default canonicalPlatformFeeBpsForPlan applies.
 */
export async function isOnFreePlan(uid: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("users").select("current_plan_id").eq("uid", uid).maybeSingle();
  const planId = data?.current_plan_id;
  return !plans.some((plan) => plan.id !== "free" && plan.id === planId);
}

/**
 * Maps a thrown error to the JSON response the payment clients expect. Known,
 * user-safe errors are surfaced verbatim with their status + code; anything
 * unexpected is logged and returned as an opaque 500 so internals never leak.
 */
export function paymentErrorResponse(error: unknown): NextResponse {
  if (error instanceof StripeConfigError) {
    // Dormant flows stay silent; an enabled payment flow must not fail unnoticed.
    if (process.env.NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED === "true"
      || isPublicFeatureEnabled("payments.checkout")
      || Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)) {
      notifyOps({
        event: "payments.configuration.unavailable",
        severity: "critical",
        summary: "O pagamento esta habilitado, mas falta uma configuracao necessaria. Compras podem estar bloqueadas. Revise a configuracao e publique novamente.",
        context: { status: 503 },
      });
    }
    return NextResponse.json(
      { error: error.message, code: "payments_not_configured" },
      { status: 503 },
    );
  }
  if (error instanceof PaymentError) {
    if (error.status === 502 && error.code === "stripe_dashboard_unavailable") {
      notifyOps({
        event: "payments.dashboard.unavailable",
        severity: "warn",
        summary: "Um professor nao conseguiu abrir o painel da Stripe. Verifique a disponibilidade da integracao e a conta de recebimento.",
        context: { status: 502 },
      });
    }
    return NextResponse.json(
      { error: error.message, ...(error.code ? { code: error.code } : {}) },
      { status: error.status },
    );
  }
  console.error("Unhandled payment route error");
  notifyOps({
    event: "payments.request.failed",
    severity: "critical",
    summary: "Uma operacao de pagamento falhou inesperadamente. O cliente pode nao ter conseguido concluir. Verifique as falhas de pagamento antes de pedir nova tentativa.",
    context: { status: 500 },
  });
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
