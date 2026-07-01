"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import type {
  AuthSession,
  EmailPasswordCredentials,
  SignupInput,
  SkillsetUser,
} from "@/domain/auth";
import type { UserProfile } from "@/domain/user-profile";
import { getUserProfile, upsertUserProfile } from "@/lib/data/user-profiles";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

function authCallbackUrl(path: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return `${window.location.origin}${path}`;
}

export function mapSupabaseUser(
  user: User,
  profile?: UserProfile | null,
): SkillsetUser {
  const metadata = user.user_metadata ?? {};
  const metaName =
    (metadata.name as string | undefined) ||
    (metadata.full_name as string | undefined) ||
    (metadata.display_name as string | undefined);
  const metaPhoto =
    (metadata.avatar_url as string | undefined) ||
    (metadata.picture as string | undefined);

  return {
    uid: user.id,
    email: user.email ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
    // Prefer the DB profile; treat empty strings as "unset" so a blank profile
    // value still falls back to the auth record instead of a missing name.
    displayName: profile?.displayName || metaName || null,
    photoURL: profile?.photoURL || metaPhoto || null,
    roles: profile?.roles ?? ["student"],
  };
}

export function listenToAuthState(callback: (session: AuthSession) => void) {
  const supabase = getSupabaseBrowserClient();

  callback({ status: "loading", user: null });

  const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
    const user = session?.user ?? null;

    if (!user) {
      callback({ status: "unauthenticated", user: null });
      return;
    }

    // Read-only hot path. The on_auth_user_created trigger provisions the row at
    // signup, so this only repairs a MISSING row (defensive) before resolving.
    let profile = await getUserProfile(user.id);

    if (!profile) {
      await upsertUserProfile({
        uid: user.id,
        email: user.email ?? null,
        displayName: (user.user_metadata?.name as string | undefined) ?? null,
        photoURL:
          (user.user_metadata?.avatar_url as string | undefined) ?? null,
      });
      profile = await getUserProfile(user.id);
    }

    callback({ status: "authenticated", user: mapSupabaseUser(user, profile) });
  });

  return () => {
    data.subscription.unsubscribe();
  };
}

/** Reads the current session's user + profile without opening a listener. */
export async function getCurrentSkillsetUser(): Promise<SkillsetUser | null> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  return mapSupabaseUser(user, await getUserProfile(user.id));
}

export async function signInWithEmail({
  email,
  password,
}: EmailPasswordCredentials): Promise<SkillsetUser> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  await requireSecondFactorIfNeeded(supabase);

  return mapSupabaseUser(data.user, await getUserProfile(data.user.id));
}

export async function signUpWithEmail({
  displayName,
  email,
  password,
}: SignupInput): Promise<SkillsetUser> {
  const supabase = getSupabaseBrowserClient();
  const trimmedName = displayName.trim();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: trimmedName
        ? { display_name: trimmedName, name: trimmedName }
        : undefined,
      emailRedirectTo: authCallbackUrl("/auth/confirm"),
    },
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("Sign up did not return a user.");
  }

  // The on_auth_user_created trigger provisions public.users (display_name from
  // the metadata above). When email confirmation is required data.session is
  // null and the client can't read the row yet — the app's verify-email
  // onboarding screen drives that state, so a null profile here is expected.
  return mapSupabaseUser(data.user, await getUserProfile(data.user.id));
}

export async function signInWithGoogle(): Promise<SkillsetUser> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: authCallbackUrl("/auth/callback") },
  });

  if (error) {
    throw error;
  }

  // signInWithOAuth navigates the browser to Google; this page is unloading, so
  // the redirect wins and the returned promise never needs to resolve. Callers
  // `await` it purely to keep their loading state until navigation happens.
  return new Promise<SkillsetUser>(() => {});
}

export async function resetPassword(email: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: authCallbackUrl("/auth/callback?next=/account"),
  });

  if (error) {
    throw error;
  }
}

export async function sendSkillsetEmailVerification(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    throw new Error("No authenticated user.");
  }

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: user.email,
    options: { emailRedirectTo: authCallbackUrl("/auth/confirm") },
  });

  if (error) {
    throw error;
  }
}

export async function refreshCurrentUserEmailVerification(): Promise<boolean> {
  const supabase = getSupabaseBrowserClient();
  // getUser() validates against the server, returning the freshest
  // email_confirmed_at rather than the possibly-stale cached session.
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return false;
  }

  return Boolean(data.user.email_confirmed_at);
}

export async function requestSkillsetEmailChange(
  newEmail: string,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const normalizedEmail = newEmail.trim().toLowerCase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("No authenticated user.");
  }

  if (!normalizedEmail || normalizedEmail === user.email?.toLowerCase()) {
    throw new Error("Use a different valid email address.");
  }

  const { error } = await supabase.auth.updateUser(
    { email: normalizedEmail },
    { emailRedirectTo: authCallbackUrl("/auth/confirm") },
  );

  if (error) {
    throw error;
  }
}

export async function changeSkillsetPassword(
  currentPassword: string,
  nextPassword: string,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    throw new Error("Email/password authentication is required.");
  }

  // Re-authenticate by verifying the current password before allowing a change.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (reauthError) {
    throw reauthError;
  }

  const { error } = await supabase.auth.updateUser({ password: nextPassword });

  if (error) {
    throw error;
  }
}

export async function signOutOfSkillset(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw error;
  }
}

export function getAuthErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  const rawMessage =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message)
      : "";
  const message = rawMessage.toLowerCase();

  const matches = (needle: string) =>
    code.includes(needle) || message.includes(needle);

  if (matches("multi-factor") || matches("aal2")) {
    return "Enter the code from your authenticator app to finish signing in.";
  }

  if (
    matches("invalid_credentials") ||
    matches("invalid login credentials") ||
    matches("invalid-credential")
  ) {
    return "The email or password is incorrect.";
  }

  if (matches("email_not_confirmed") || matches("email not confirmed")) {
    return "Verify your email to finish signing in. Check your inbox for the link.";
  }

  if (matches("user_already_exists") || matches("already registered")) {
    return "An account already exists with this email.";
  }

  if (matches("weak_password") || matches("password should be at least")) {
    return "Use a stronger password with at least 8 characters.";
  }

  if (matches("over_email_send_rate_limit") || matches("rate limit")) {
    return "Too many attempts. Wait a moment and try again.";
  }

  if (matches("otp_expired") || matches("token has expired")) {
    return "That link or code expired. Request a fresh one and try again.";
  }

  if (matches("invalid_otp") || matches("invalid totp") || matches("otp")) {
    return "That code didn't match. Check your authenticator app and try again.";
  }

  if (matches("user_not_found")) {
    return "We couldn't find an account for that email.";
  }

  if (matches("provider is not enabled") || matches("validation_failed")) {
    return "This sign-in method isn't enabled yet.";
  }

  if (matches("email address") && matches("invalid")) {
    return "Enter a valid email address.";
  }

  if (matches("network") || matches("fetch")) {
    return "Network request failed. Check your connection and try again.";
  }

  return rawMessage || "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Two-factor authentication (TOTP)
//
// Supabase models the second factor as an assurance-level gate rather than a
// thrown error: signInWithPassword succeeds at aal1, and a verified TOTP factor
// means the session must be raised to aal2. To preserve the existing UI's
// error-driven flow (catch -> show code input -> completeMfaSignIn), the sign-in
// helper detects the aal1->aal2 gap and throws MfaRequiredError.
// ---------------------------------------------------------------------------

export class MfaRequiredError extends Error {
  readonly code = "auth/multi-factor-auth-required";
  readonly factorId: string;

  constructor(factorId: string) {
    super("Multi-factor authentication required.");
    this.name = "MfaRequiredError";
    this.factorId = factorId;
  }
}

/** Opaque handle returned by startTotpEnrollment and consumed by finish. */
export type TotpSecret = { factorId: string };

/** A verified authenticator factor on the current user. */
export type EnrolledFactor = {
  uid: string;
  displayName: string;
  enrolledAt: string | null;
};

export function isMultiFactorRequiredError(
  error: unknown,
): error is MfaRequiredError {
  if (error instanceof MfaRequiredError) {
    return true;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String((error as { code?: unknown }).code).includes("multi-factor")
  );
}

async function requireSecondFactorIfNeeded(
  supabase: SupabaseClient<Database>,
): Promise<void> {
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error || !data) {
    return;
  }

  if (data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verifiedTotp = factors?.totp?.find(
      (factor) => factor.status === "verified",
    );

    if (verifiedTotp) {
      throw new MfaRequiredError(verifiedTotp.id);
    }
  }
}

export async function completeMfaSignIn(
  error: MfaRequiredError,
  code: string,
): Promise<SkillsetUser> {
  const supabase = getSupabaseBrowserClient();

  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId: error.factorId });

  if (challengeError) {
    throw challengeError;
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: error.factorId,
    challengeId: challenge.id,
    code: code.trim(),
  });

  if (verifyError) {
    throw verifyError;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("No authenticated user after MFA.");
  }

  return mapSupabaseUser(user, await getUserProfile(user.id));
}

export async function startTotpEnrollment(): Promise<{
  secret: TotpSecret;
  secretKey: string;
  otpauthUrl: string;
}> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Sign in again before enabling two-factor authentication.");
  }

  // Clear any stale unverified factor so re-enrollment never hits a limit clash.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  const stale =
    existing?.all?.filter(
      (factor) => factor.factor_type === "totp" && factor.status !== "verified",
    ) ?? [];
  for (const factor of stale) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
  });

  if (error) {
    throw error;
  }

  return {
    secret: { factorId: data.id },
    secretKey: data.totp.secret,
    otpauthUrl: data.totp.uri,
  };
}

export async function finishTotpEnrollment(
  secret: TotpSecret,
  code: string,
  displayName = "Authenticator app",
): Promise<void> {
  void displayName; // API parity; Supabase names the factor at enroll time.
  const supabase = getSupabaseBrowserClient();

  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId: secret.factorId });

  if (challengeError) {
    throw challengeError;
  }

  const { error } = await supabase.auth.mfa.verify({
    factorId: secret.factorId,
    challengeId: challenge.id,
    code: code.trim(),
  });

  if (error) {
    throw error;
  }
}

export async function listEnrolledTotpFactors(): Promise<EnrolledFactor[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.mfa.listFactors();

  if (error || !data) {
    return [];
  }

  return data.totp
    .filter((factor) => factor.status === "verified")
    .map((factor) => ({
      uid: factor.id,
      displayName: factor.friendly_name ?? "Authenticator app",
      enrolledAt: factor.updated_at ?? factor.created_at ?? null,
    }));
}

export async function unenrollTotpFactor(factorUid: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: factorUid });

  if (error) {
    throw error;
  }
}
