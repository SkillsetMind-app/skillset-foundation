"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import type {
  AuthSession,
  EmailPasswordCredentials,
  SignupInput,
  SkillsetUser,
} from "@/domain/auth";
import type { UserProfile } from "@/domain/user-profile";
import { assertPasswordNotBreached } from "@/lib/auth/pwned-password";
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

  // Monotonic sequence so a slow profile read for an older auth event can never
  // overwrite the state produced by a newer one.
  let eventSeq = 0;

  // Última sessão realmente emitida, para não emitir de novo o que não mudou.
  //
  // POR QUE ISTO EXISTE
  //
  // `onAuthStateChange` dispara em coisas que não mudam nada para o app —
  // `TOKEN_REFRESHED` (a cada ~1h), `SIGNED_IN` ao voltar o foco da aba. A cada
  // disparo, `mapSupabaseUser` devolvia um OBJETO NOVO com exatamente o mesmo
  // conteúdo. E 41 efeitos deste app declaram `[user]` como dependência — o
  // objeto, não o uid.
  //
  // Cinco desses efeitos semeiam campos EDITÁVEIS a partir do servidor
  // (perfil, storefront, verificação de criador, eventos). O professor escrevia
  // a tagline, o token era renovado no meio, o efeito rodava de novo e
  // sobrescrevia tudo com o último valor salvo. Digitação perdida sem uma
  // palavra, e sem nada que o usuário pudesse ter feito diferente.
  //
  // O conserto vai na FONTE, não nos 41 chamadores: emitir só quando o conteúdo
  // muda de fato. `SkillsetUser` é um objeto raso de primitivos mais um array
  // de papéis, então comparar o JSON é confiável e barato. Um falso "mudou"
  // apenas repete o comportamento antigo — o erro seguro é para este lado.
  let lastEmitted: string | null = null;

  function emit(next: AuthSession) {
    const signature = JSON.stringify({
      status: next.status,
      user: next.user,
    });

    if (signature === lastEmitted) {
      return;
    }

    lastEmitted = signature;
    callback(next);
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user ?? null;
    const seq = ++eventSeq;

    if (!user) {
      emit({ status: "unauthenticated", user: null });
      return;
    }

    // Supabase holds its internal auth lock while notifying subscribers, and
    // awaiting other Supabase calls inside this callback can deadlock — the app
    // then hangs on "loading" forever (documented onAuthStateChange gotcha).
    // Defer the profile read to the next tick so it runs outside the lock.
    async function resolveProfile(currentUser: User) {
      // Read-only hot path. The on_auth_user_created trigger provisions the row
      // at signup, so this only repairs a MISSING row (defensive).
      let profile = await getUserProfile(currentUser.id);

      if (!profile) {
        await upsertUserProfile({
          uid: currentUser.id,
          email: currentUser.email ?? null,
          displayName:
            (currentUser.user_metadata?.name as string | undefined) ?? null,
          photoURL:
            (currentUser.user_metadata?.avatar_url as string | undefined) ??
            null,
        });
        profile = await getUserProfile(currentUser.id);
      }

      if (seq === eventSeq) {
        emit({
          status: "authenticated",
          user: mapSupabaseUser(currentUser, profile),
        });
      }
    }

    window.setTimeout(() => {
      void resolveProfile(user);
    }, 0);
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

export async function signInWithEmail(
  { email, password }: EmailPasswordCredentials,
  captchaToken?: string,
): Promise<SkillsetUser> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    // Ignored by Supabase unless CAPTCHA is enabled; undefined when the
    // Turnstile widget is off, so this is a no-op on the default free tier.
    options: captchaToken ? { captchaToken } : undefined,
  });

  if (error) {
    throw error;
  }

  await requireSecondFactorIfNeeded(supabase);

  return mapSupabaseUser(data.user, await getUserProfile(data.user.id));
}

export type SignupResult = {
  user: SkillsetUser;
  /**
   * True when Supabase created the account but returned no session, i.e. the
   * project requires email confirmation. Nothing that needs a signed-in client
   * (profile writes, onboarding) can run yet — RLS filters every row and a
   * zero-row update comes back as a silent success.
   */
  needsEmailConfirmation: boolean;
};

export async function signUpWithEmail(
  { displayName, email, password }: SignupInput,
  captchaToken?: string,
): Promise<SignupResult> {
  const supabase = getSupabaseBrowserClient();
  const trimmedName = displayName.trim();

  // Reject passwords known to be compromised in a breach corpus (HIBP) — the
  // guard Supabase reserves for its Pro plan, done here on the free tier.
  await assertPasswordNotBreached(password);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: trimmedName
        ? { display_name: trimmedName, name: trimmedName }
        : undefined,
      emailRedirectTo: authCallbackUrl("/auth/confirm"),
      // No-op unless Supabase CAPTCHA is enabled + the Turnstile widget is on.
      captchaToken: captchaToken || undefined,
    },
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error("Sign up did not return a user.");
  }

  // With email confirmation on, Supabase anti-enumeration returns a FAKE
  // success (a user with empty identities) when the email already has an
  // account — and the existing password is untouched. Without this check the
  // wizard reads as a working signup and the user locks themselves out with a
  // password that was never saved.
  if (data.user.identities && data.user.identities.length === 0) {
    throw Object.assign(
      new Error("An account already exists with this email."),
      { code: "user_already_exists" },
    );
  }

  // The on_auth_user_created trigger provisions public.users (display_name from
  // the metadata above). When email confirmation is required data.session is
  // null and the client can't read the row yet, so a null profile here is
  // expected — the caller shows the confirm-your-email screen instead.
  return {
    user: mapSupabaseUser(data.user, await getUserProfile(data.user.id)),
    needsEmailConfirmation: !data.session,
  };
}

// `next` is where the browser lands after Google: /auth/callback exchanges the
// code and forwards it verbatim. Callers pass a /loading URL (getLoadingRoute)
// so the usual post-auth router decides — a new account goes to onboarding, an
// onboarded one to its deep link or workspace. Without it the callback fell
// back to "/", which skipped onboarding and dropped the deep link for every
// Google sign-in; the code after this call in the forms never runs (see below).
export async function signInWithGoogle(next: string): Promise<SkillsetUser> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: authCallbackUrl(
        `/auth/callback?next=${encodeURIComponent(next)}`,
      ),
    },
  });

  if (error) {
    throw error;
  }

  // signInWithOAuth navigates the browser to Google; this page is unloading, so
  // the redirect wins and the returned promise never needs to resolve. Callers
  // `await` it purely to keep their loading state until navigation happens.
  return new Promise<SkillsetUser>(() => {});
}

export async function resetPassword(
  email: string,
  captchaToken?: string,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Lands on the dedicated reset page — /account's change-password form
    // demands the current password, which is exactly what the user forgot.
    // /auth/confirm (verifyOtp), not /auth/callback (PKCE): the recovery email
    // is routinely opened on a different device than the one that asked for it,
    // and PKCE's code_verifier cookie doesn't travel between browsers.
    redirectTo: authCallbackUrl("/auth/confirm?next=/reset-password"),
    // No-op unless Supabase CAPTCHA is enabled + the Turnstile widget is on.
    captchaToken: captchaToken || undefined,
  });

  if (error) {
    throw error;
  }
}

/**
 * Sets a new password for the recovery session established by the reset link
 * (via /auth/callback). No current password required — that's the point.
 */
export async function completePasswordRecovery(
  newPassword: string,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error(
      "This reset link is invalid or has expired. Request a new one.",
    );
  }

  await assertPasswordNotBreached(newPassword);

  const { error } = await supabase.auth.updateUser({ password: newPassword });

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
  captchaToken?: string,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    throw new Error("Email/password authentication is required.");
  }

  // Re-authenticate by verifying the current password before allowing a change.
  // Same CAPTCHA contract as signInWithEmail: with Attack Protection on, GoTrue
  // refuses a password sign-in that carries no token — and this is one.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
    options: captchaToken ? { captchaToken } : undefined,
  });

  if (reauthError) {
    throw reauthError;
  }

  await assertPasswordNotBreached(nextPassword);

  const { error } = await supabase.auth.updateUser({ password: nextPassword });

  if (error) {
    throw error;
  }
}

export async function signOutOfSkillsetMind(): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw error;
  }
}

// Shared by getAuthErrorMessage and the flow-specific predicates below, so a
// new GoTrue error shape only has to be taught to one place.
function authErrorMatcher(error: unknown) {
  const details =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; message?: unknown; status?: unknown })
      : {};
  // Only trust string fields — String(undefined) would leak "undefined" into
  // the UI, which is exactly the invisible/garbage-error class this fixes.
  const code = typeof details.code === "string" ? details.code.toLowerCase() : "";
  const rawMessage =
    typeof details.message === "string" ? details.message.trim() : "";
  const status = typeof details.status === "number" ? details.status : undefined;
  const message = rawMessage.toLowerCase();

  return {
    rawMessage,
    status,
    matches: (needle: string) =>
      code.includes(needle) || message.includes(needle),
  };
}

// The generic copy for this case is "Too many attempts", which reads as "your
// request did not go through". For anything that sends an email, the opposite
// is true: the limit only trips because an earlier send succeeded. Callers that
// know which email they asked for use this to say so.
export function isEmailRateLimitError(error: unknown): boolean {
  const { matches } = authErrorMatcher(error);
  return matches("rate_limit") || matches("rate limit");
}

// Signup can only fail this way because the account is already there, so the
// way forward is signing in, not pressing "Create account" again. Callers that
// know that render the link.
export function isAccountExistsError(error: unknown): boolean {
  const { matches } = authErrorMatcher(error);
  return matches("user_already_exists") || matches("already registered");
}

export function getAuthErrorMessage(error: unknown): string {
  const { rawMessage, status, matches } = authErrorMatcher(error);

  if (matches("multi-factor") || matches("aal2")) {
    return "Enter the code from your authenticator app to finish signing in.";
  }

  if (
    matches("invalid_credentials") ||
    matches("invalid login credentials") ||
    matches("invalid-credential")
  ) {
    return "Incorrect email or password.";
  }

  if (matches("email_not_confirmed") || matches("email not confirmed")) {
    return "Verify your email to finish signing in. Check your inbox for the link.";
  }

  if (isAccountExistsError(error)) {
    return "An account already exists with this email.";
  }

  if (matches("pwned_password")) {
    return "This password appeared in a known data breach. Pick a different one to keep the account secure.";
  }

  if (matches("weak_password") || matches("password should be at least")) {
    return "Use a stronger password with at least 8 characters.";
  }

  // Supabase refuses every sign-in/signup when CAPTCHA protection is on in the
  // project but the client sends no token. Raw GoTrue text ("captcha protection:
  // request disallowed") leaks config detail and tells the visitor nothing.
  if (matches("captcha")) {
    return "The security check did not go through. Reload the page and try again.";
  }

  // Covers over_email_send_rate_limit, over_request_rate_limit and the
  // human-readable "rate limit" variants GoTrue puts in messages.
  if (matches("rate_limit") || matches("rate limit")) {
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

  if (matches("same_password") || matches("different from the old")) {
    return "Your new password must be different from your old password.";
  }

  if (matches("error sending recovery email")) {
    return "We could not send the password reset email. Please try again in a few minutes or contact support.";
  }

  // GoTrue signals a broken SMTP pipeline with this exact message and rolls
  // the signup back — surface it as a real failure, never a blank error.
  if (matches("error sending confirmation email")) {
    return "We could not send the confirmation email. Please try again in a few minutes or contact support.";
  }

  // Any other unexpected_failure / HTTP 500 is a generic server-side error
  // (this mapper is shared by sign-in, MFA, password change and recovery), so
  // stay operation-neutral instead of guessing which flow broke.
  if (matches("unexpected_failure") || status === 500) {
    return "Something went wrong on our end. Please try again in a few minutes.";
  }

  if (matches("network") || matches("fetch")) {
    return "Network request failed. Check your connection and try again.";
  }

  // rawMessage is a trimmed string, so every path returns non-empty copy.
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
