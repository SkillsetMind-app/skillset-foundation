import { createHmac, timingSafeEqual } from "node:crypto";

import { isPlatformHost, normaliseHostHeader } from "@/domain/host-routing";
import { currentPrivacyVersion, currentTermsVersion } from "@/lib/legal/versions";
import { isGuestCheckoutEnabled } from "@/lib/payments/guest-checkout";
import { getAppUrl } from "@/lib/payments/server/app-url";
import { PaymentError } from "@/lib/payments/server/auth";
import { GUEST_CHECKOUT_ORIGIN } from "@/lib/payments/server/guest-access-link";
import type { getSupabaseAdminClient } from "@/lib/supabase/admin";

// Server side of guest checkout (see /api/payments/guest-checkout).

export { GUEST_CHECKOUT_ORIGIN, sendGuestAccessLink } from "@/lib/payments/server/guest-access-link";

type Admin = ReturnType<typeof getSupabaseAdminClient>;

/** Signed { email, courseId } so the thank-you page can name the address and resend the link. */
export const GUEST_CHECKOUT_COOKIE = "sm_guest_checkout";
const COOKIE_TTL_SECONDS = 2 * 60 * 60;

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * The public switch plus the two server secrets (Turnstile, and the one that
 * signs the thank-you cookie). Any of them missing: the routes are off.
 */
export function isGuestCheckoutConfigured(): boolean {
  return isGuestCheckoutEnabled()
    && Boolean(process.env.TURNSTILE_SECRET_KEY)
    && Boolean(process.env.GUEST_CHECKOUT_COOKIE_SECRET);
}

/**
 * Guest checkout runs only on the platform's own hosts. A request that comes
 * through a creator's own domain is answered like the feature being off.
 */
export function isPlatformRequest(request: Request): boolean {
  const host = normaliseHostHeader(request.headers.get("host") ?? new URL(request.url).host);
  return host !== null && isPlatformHost(host);
}

/**
 * Cloudflare Turnstile, checked server-side. Any failure (network, timeout,
 * bad answer) is a "no", and so is a token solved on another hostname than
 * this app's (www and the bare domain count as the same).
 */
export async function verifyTurnstileToken(token: string, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set("remoteip", ip);
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown; hostname?: unknown };
    return result.success === true && isAppHostname(result.hostname);
  } catch {
    return false;
  }
}

function isAppHostname(hostname: unknown): boolean {
  if (typeof hostname !== "string" || !hostname) return false;
  const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return bare(hostname) === bare(new URL(getAppUrl()).hostname);
}

/**
 * The account id for an e-mail, from auth.users (what sign-in uses).
 * public.users.email is editable by its owner, so it is never the lookup.
 */
async function findAuthUserIdByEmail(admin: Admin, email: string): Promise<string | null> {
  const { data, error } = await admin.rpc("find_auth_user_id_by_email", { p_email: email });
  if (error) throw new Error(error.message);
  return typeof data === "string" && data ? data : null;
}

/**
 * The buyer's account: the existing one for this e-mail (untouched: no
 * sign-in, no metadata, no terms), or a new one created silently: no password,
 * unconfirmed, no e-mail sent. A new account records the terms and privacy
 * acceptance the form required, like a normal signup.
 */
export async function findOrCreateGuestBuyer(
  admin: Admin,
  input: { email: string; name: string; locale: string },
): Promise<{ userId: string; created: boolean }> {
  const existing = await findAuthUserIdByEmail(admin, input.email);
  if (existing) {
    await completeUnfinishedGuestTerms(admin, existing);
    return { userId: existing, created: false };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    email_confirm: false,
    user_metadata: { name: input.name, locale: input.locale, created_via: GUEST_CHECKOUT_ORIGIN },
    app_metadata: { created_via: GUEST_CHECKOUT_ORIGIN },
  });
  if (data?.user) {
    try {
      await recordTermsAcceptance(admin, data.user.id);
    } catch (termsError) {
      // Without its terms the account would stay that way: the next attempt
      // finds it as an existing one. Remove it so a retry starts clean.
      await discardNewGuestBuyer(admin, data.user.id);
      throw termsError;
    }
    return { userId: data.user.id, created: true };
  }

  // A double submit or a signup created it between the lookup and here.
  const raced = await findAuthUserIdByEmail(admin, input.email);
  if (raced) return { userId: raced, created: false };
  // The address cannot take an account here. Same answer as a course that
  // cannot be bought.
  console.error("[guest-checkout] account not created", { code: error?.code ?? null });
  throw new PaymentError("This course is not available for purchase right now.");
}

/**
 * Removes an account this request created, when the purchase it was made for
 * does not go ahead. Best effort: it never changes what the buyer is told.
 */
export async function discardNewGuestBuyer(admin: Admin, userId: string): Promise<void> {
  try {
    // A sibling request may already be checking out with this account.
    const [lock, order] = await Promise.all([
      admin.from("checkout_locks").select("lock_key").eq("user_id", userId).limit(1).maybeSingle(),
      admin.from("orders").select("id").eq("user_id", userId).limit(1).maybeSingle(),
    ]);
    if (lock.error || order.error || lock.data || order.data) return;
    // ponytail: a sibling can still claim a lock between this read and the
    // delete; a row lock per account if that window ever matters.
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("[guest-checkout] new account not removed", { status: error.status ?? null, code: error.code ?? null });
      return;
    }
    // public.users has no foreign key to auth.users, so its row goes separately.
    // An order row that already points at it keeps it (orders.user_id).
    const { error: profileError } = await admin.from("users").delete().eq("uid", userId);
    if (profileError) console.error("[guest-checkout] profile row kept", { code: profileError.code ?? null });
  } catch {
    console.error("[guest-checkout] new account not removed");
  }
}

/**
 * An account this flow created earlier, that never confirmed its e-mail and
 * has no terms on record (an earlier attempt stopped half-way), records them
 * now: the form requires the acceptance on every submission. Any other
 * account is left untouched. A failure stops the purchase with a retryable
 * error.
 */
async function completeUnfinishedGuestTerms(admin: Admin, userId: string): Promise<void> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) throw new Error("Guest buyer account could not be read.");
  if (data.user.app_metadata?.created_via !== GUEST_CHECKOUT_ORIGIN || data.user.email_confirmed_at) return;
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("terms_accepted_at")
    .eq("uid", userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (profile?.terms_accepted_at) return;
  await recordTermsAcceptance(admin, userId);
}

async function recordTermsAcceptance(admin: Admin, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("users")
    .update({
      terms_accepted_at: now,
      terms_version: currentTermsVersion,
      privacy_accepted_at: now,
      privacy_version: currentPrivacyVersion,
      updated_at: now,
    })
    .eq("uid", userId)
    .select("uid");
  if (error) throw new Error(error.message);
  // handle_new_user creates the row with the auth user; none means no record.
  if (!data?.length) throw new Error("Guest buyer profile row is missing.");
}

// Its own key (GUEST_CHECKOUT_COOKIE_SECRET), used for nothing else.
function sign(payload: string): string {
  return createHmac("sha256", process.env.GUEST_CHECKOUT_COOKIE_SECRET ?? "")
    .update(`guest-checkout-cookie:${payload}`)
    .digest("base64url");
}

export function encodeGuestCheckoutCookie(value: { email: string; courseId: string }, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ e: value.email, c: value.courseId, x: now + COOKIE_TTL_SECONDS * 1000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeGuestCheckoutCookie(
  raw: string | undefined,
  now = Date.now(),
): { email: string; courseId: string } | null {
  if (!raw || !process.env.GUEST_CHECKOUT_COOKIE_SECRET) return null;
  const [payload, signature, extra] = raw.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { e?: unknown; c?: unknown; x?: unknown };
    if (typeof data.e !== "string" || typeof data.c !== "string" || !(Number(data.x) > now)) return null;
    return { email: data.e, courseId: data.c };
  } catch {
    return null;
  }
}

export function guestCheckoutCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_TTL_SECONDS,
  };
}
