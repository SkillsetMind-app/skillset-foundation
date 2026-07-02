import { NextResponse } from "next/server";

import { StripeConfigError } from "@/lib/payments/server/stripe";
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
  const { data: isAdmin, error } = await supabase.rpc("is_admin");
  if (error || !isAdmin) {
    throw new PaymentError("Admin privileges are required.", 403, "permission_denied");
  }
  return userData.user.id;
}

type ServerSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Shared rate-limit gate for the payment Route Handlers. Wraps the
 * enforce_rate_limit SECURITY DEFINER RPC and throws PaymentError(429) on limit.
 * Single-sourcing it means a new route can't silently ship without a throttle —
 * which is exactly how connect/refresh went unprotected. `key` scopes the
 * bucket (convention: `${action}_${uid}`).
 */
export async function enforceRateLimit(
  supabase: ServerSupabaseClient,
  key: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const { error } = await supabase.rpc("enforce_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });
  if (error) {
    if (error.message?.includes("RATE_LIMIT")) {
      throw new PaymentError("Too many attempts. Please wait before trying again.", 429);
    }
    throw new Error(error.message);
  }
}

/**
 * Maps a thrown error to the JSON response the payment clients expect. Known,
 * user-safe errors are surfaced verbatim with their status + code; anything
 * unexpected is logged and returned as an opaque 500 so internals never leak.
 */
export function paymentErrorResponse(error: unknown): NextResponse {
  if (error instanceof StripeConfigError) {
    // Founder-gated dormant state: Stripe isn't configured yet. Not an error the
    // buyer caused — the UI shows a calm "payments being set up" notice.
    return NextResponse.json(
      { error: error.message, code: "payments_not_configured" },
      { status: 503 },
    );
  }
  if (error instanceof PaymentError) {
    return NextResponse.json(
      { error: error.message, ...(error.code ? { code: error.code } : {}) },
      { status: error.status },
    );
  }
  console.error("Unhandled payment route error", error);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
