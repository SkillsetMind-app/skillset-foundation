"use client";

import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getMultiFactorResolver,
  multiFactor,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  TotpMultiFactorGenerator,
  updateProfile,
  updatePassword,
  verifyBeforeUpdateEmail,
  type MultiFactorError,
  type MultiFactorInfo,
  type TotpSecret,
  type User,
} from "firebase/auth";

import type {
  AuthSession,
  EmailPasswordCredentials,
  SignupInput,
  SkillsetUser,
} from "@/domain/auth";
import type { UserProfile } from "@/domain/user-profile";
import { getUserProfile, upsertUserProfile } from "@/lib/data/user-profiles";
import { getFirebaseAuth } from "@/lib/firebase/client";

export function mapFirebaseUser(
  user: User,
  profile?: UserProfile | null,
): SkillsetUser {
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    // Prefer the Firestore profile, but treat empty strings as "unset" so a
    // blank profile value still falls back to the Firebase Auth record
    // instead of rendering as a missing name/photo.
    displayName: profile?.displayName || user.displayName || null,
    photoURL: profile?.photoURL || user.photoURL || null,
    roles: profile?.roles ?? ["student"],
  };
}

export function listenToAuthState(callback: (session: AuthSession) => void) {
  const auth = getFirebaseAuth();

  callback({ status: "loading", user: null });

  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      // Read-only hot path. This listener fires on EVERY page load, and it
      // used to run a serial profile write (upsert) + read before auth could
      // resolve — delaying every authenticated surface by a round-trip. The
      // sign-in/sign-up flows already upsert (signInWithEmail,
      // signUpWithEmail, signInWithGoogle below), so the listener only
      // repairs a MISSING profile doc (legacy account or an interrupted
      // signup) before resolving the session.
      let profile = await getUserProfile(user.uid);

      if (!profile) {
        await upsertUserProfile({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        });
        profile = await getUserProfile(user.uid);
      }

      callback({
        status: "authenticated",
        user: mapFirebaseUser(user, profile),
      });

      return;
    }

    callback({
      status: "unauthenticated",
      user: null,
    });
  });
}

// Forces the Firebase Auth ID token to propagate to Firestore rules before
// we attempt any privileged writes. Without this, the first setDoc after
// createUserWithEmailAndPassword can race ahead of request.auth being set,
// surfacing as a permission-denied that looks like a rules bug.
async function waitForIdTokenReady(user: User): Promise<void> {
  try {
    await user.getIdToken(true);
  } catch (error) {
    console.error(
      "waitForIdTokenReady: getIdToken failed",
      { uid: user.uid },
      error,
    );
  }
}

async function runUpsertWithRetry(
  input: Parameters<typeof upsertUserProfile>[0],
  context: string,
): Promise<void> {
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await upsertUserProfile(input);
      if (attempt > 1) {
        console.info(
          `${context}: upsertUserProfile succeeded on retry`,
          { uid: input.uid, attempt },
        );
      }
      return;
    } catch (error) {
      lastError = error;
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      const isPermissionDenied = code.includes("permission-denied");
      const isLastAttempt = attempt === maxAttempts;

      console.error(
        `${context}: upsertUserProfile failed (attempt ${attempt}/${maxAttempts})`,
        {
          uid: input.uid,
          email: input.email,
          hasDisplayName: Boolean(input.displayName),
          hasPhotoURL: Boolean(input.photoURL),
          code,
          isPermissionDenied,
        },
        error,
      );

      if (isLastAttempt) {
        break;
      }

      // Backoff before retrying. Permission-denied is most often a token
      // propagation race, so give Firestore a moment to catch up.
      const delayMs = 250 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

export async function signInWithEmail({ email, password }: EmailPasswordCredentials) {
  const auth = getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  await waitForIdTokenReady(credential.user);
  await runUpsertWithRetry(
    {
      uid: credential.user.uid,
      email: credential.user.email,
      displayName: credential.user.displayName,
      photoURL: credential.user.photoURL,
    },
    "signInWithEmail",
  );

  return mapFirebaseUser(credential.user);
}

export async function signUpWithEmail({
  displayName,
  email,
  password,
}: SignupInput) {
  const auth = getFirebaseAuth();
  const credential = await createUserWithEmailAndPassword(auth, email, password);

  if (displayName.trim()) {
    try {
      await updateProfile(credential.user, { displayName: displayName.trim() });
    } catch (error) {
      // Non-fatal: profile metadata can be retried from the onboarding screen.
      // Keep the signup moving so the user still lands inside the app.
      console.error(
        "signUpWithEmail: updateProfile failed (non-fatal)",
        { uid: credential.user.uid },
        error,
      );
    }
  }

  await waitForIdTokenReady(credential.user);
  await runUpsertWithRetry(
    {
      uid: credential.user.uid,
      email: credential.user.email,
      displayName: displayName.trim() || credential.user.displayName,
      photoURL: credential.user.photoURL,
    },
    "signUpWithEmail",
  );
  try {
    await sendEmailVerification(credential.user);
  } catch (error) {
    // Non-fatal: the account exists and the user can re-trigger verification
    // from the security/onboarding screens. Must stay visible, never swallowed.
    console.error(
      "signUpWithEmail: failed to send verification email",
      { uid: credential.user.uid },
      error,
    );
  }

  return mapFirebaseUser(credential.user);
}

export async function signInWithGoogle() {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);
  await waitForIdTokenReady(credential.user);
  await runUpsertWithRetry(
    {
      uid: credential.user.uid,
      email: credential.user.email,
      displayName: credential.user.displayName,
      photoURL: credential.user.photoURL,
    },
    "signInWithGoogle",
  );

  return mapFirebaseUser(credential.user);
}

export async function resetPassword(email: string) {
  const auth = getFirebaseAuth();

  await sendPasswordResetEmail(auth, email);
}

export async function sendSkillsetEmailVerification() {
  const user = getFirebaseAuth().currentUser;

  if (!user) {
    throw new Error("No authenticated user.");
  }

  await sendEmailVerification(user);
}

export async function refreshCurrentUserEmailVerification() {
  const user = getFirebaseAuth().currentUser;

  if (!user) {
    return false;
  }

  await reload(user);
  await user.getIdToken(true);

  return user.emailVerified;
}

export async function requestSkillsetEmailChange(newEmail: string) {
  const user = getFirebaseAuth().currentUser;
  const normalizedEmail = newEmail.trim().toLowerCase();

  if (!user) {
    throw new Error("No authenticated user.");
  }

  if (!normalizedEmail || normalizedEmail === user.email?.toLowerCase()) {
    throw new Error("Use a different valid email address.");
  }

  await verifyBeforeUpdateEmail(user, normalizedEmail);
}

export async function changeSkillsetPassword(
  currentPassword: string,
  nextPassword: string,
) {
  const user = getFirebaseAuth().currentUser;

  if (!user?.email) {
    throw new Error("Email/password authentication is required.");
  }

  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, nextPassword);
}

export async function signOutOfSkillset() {
  await signOut(getFirebaseAuth());
}

export function getAuthErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";

  if (code.includes("auth/invalid-email")) {
    return "Enter a valid email address.";
  }

  if (code.includes("auth/missing-email")) {
    return "Enter your email address.";
  }

  if (code.includes("auth/missing-password")) {
    return "Enter your password.";
  }

  if (code.includes("auth/invalid-credential")) {
    return "The email or password is incorrect.";
  }

  if (code.includes("auth/user-disabled")) {
    return "This account has been disabled. Contact support.";
  }

  if (code.includes("auth/email-already-in-use")) {
    return "An account already exists with this email.";
  }

  if (code.includes("auth/weak-password")) {
    return "Use a stronger password with at least 8 characters.";
  }

  if (code.includes("auth/popup-closed-by-user")) {
    return "The Google sign-in window was closed before completion.";
  }

  if (code.includes("auth/popup-blocked")) {
    return "Your browser blocked the Google sign-in popup.";
  }

  if (code.includes("auth/cancelled-popup-request")) {
    return "Another Google sign-in popup is already open.";
  }

  if (code.includes("auth/account-exists-with-different-credential")) {
    return "An account already exists with this email using another sign-in method.";
  }

  if (code.includes("auth/operation-not-allowed")) {
    return "This sign-in method is not enabled in Firebase Authentication.";
  }

  if (code.includes("auth/configuration-not-found")) {
    return "Firebase Authentication is not fully configured for this project.";
  }

  if (code.includes("auth/unauthorized-domain")) {
    return "This domain is not authorized in Firebase Authentication.";
  }

  if (code.includes("auth/network-request-failed")) {
    return "Network request failed. Check your connection and try again.";
  }

  if (code.includes("auth/too-many-requests")) {
    return "Too many attempts. Wait a moment and try again.";
  }

  if (code.includes("auth/requires-recent-login")) {
    return "For security, sign out and sign in again before changing this setting.";
  }

  if (
    code.includes("auth/invalid-verification-code")
    || code.includes("auth/invalid-otp")
    || code.includes("auth/missing-otp")
  ) {
    return "That code didn't match. Check your authenticator app and try again.";
  }

  if (code.includes("auth/totp-challenge-timeout")) {
    return "The code expired. Open your authenticator app for a fresh one and retry.";
  }

  if (code.includes("auth/second-factor-already-in-use")) {
    return "This authenticator is already enrolled on your account.";
  }

  if (code.includes("auth/maximum-second-factor-count-exceeded")) {
    return "You've reached the maximum number of authenticators for this account.";
  }

  if (code.includes("auth/unverified-email")) {
    return "Verify your email before enabling two-factor authentication.";
  }

  if (code.includes("auth/multi-factor-auth-required")) {
    return "Enter the code from your authenticator app to finish signing in.";
  }

  if (code.includes("auth/api-key-not-valid") || code.includes("auth/invalid-api-key")) {
    return "Firebase API key is not valid for this project.";
  }

  if (code.includes("permission-denied")) {
    return "Firestore rules blocked this action. Check database permissions.";
  }

  return code
    ? `Something went wrong (${code}).`
    : "Something went wrong. Please try again.";
}

// ---------------------------------------------------------------------------
// Two-factor authentication (TOTP)
//
// Real Firebase multi-factor wiring. Enrollment and the sign-in challenge are
// BOTH implemented here so the feature can be turned on safely — enrolling a
// second factor without a sign-in resolver would lock users out. The UI gates
// all of this behind the `auth.mfa` feature flag (and Identity Platform must be
// enabled on the Firebase project); if it isn't, generateSecret/getSession
// throw and the message is surfaced honestly instead of faking success.
// ---------------------------------------------------------------------------

export const TOTP_FACTOR_ID = TotpMultiFactorGenerator.FACTOR_ID;

/** True when a sign-in failed only because a second factor is still required. */
export function isMultiFactorRequiredError(
  error: unknown,
): error is MultiFactorError {
  return (
    typeof error === "object"
    && error !== null
    && "code" in error
    && String((error as { code?: unknown }).code).includes(
      "auth/multi-factor-auth-required",
    )
  );
}

/**
 * Starts TOTP enrollment for the current user: generates a shared secret and
 * the otpauth:// provisioning URI (for a QR or manual key entry). The secret is
 * generated and held client-side — it is never sent anywhere until the user
 * confirms a code, and is never persisted by Skillset.
 */
export async function startTotpEnrollment(): Promise<{
  secret: TotpSecret;
  secretKey: string;
  otpauthUrl: string;
}> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign in again before enabling two-factor authentication.");
  }

  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const accountName = user.email ?? user.uid;
  const otpauthUrl = secret.generateQrCodeUrl(accountName, "Skillset");

  return { secret, secretKey: secret.secretKey, otpauthUrl };
}

/** Confirms the 6-digit code and enrolls the authenticator as a second factor. */
export async function finishTotpEnrollment(
  secret: TotpSecret,
  code: string,
  displayName = "Authenticator app",
): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign in again before enabling two-factor authentication.");
  }

  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
    secret,
    code.trim(),
  );
  await multiFactor(user).enroll(assertion, displayName);
}

/** Currently enrolled TOTP factors for the signed-in user (synchronous read). */
export function listEnrolledTotpFactors(): MultiFactorInfo[] {
  const user = getFirebaseAuth().currentUser;
  if (!user) {
    return [];
  }
  return multiFactor(user).enrolledFactors.filter(
    (factor) => factor.factorId === TOTP_FACTOR_ID,
  );
}

/** Removes an enrolled factor by its uid. */
export async function unenrollTotpFactor(factorUid: string): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign in again to manage two-factor authentication.");
  }
  await multiFactor(user).unenroll(factorUid);
}

/**
 * Completes a sign-in that was interrupted by the MFA challenge. Given the
 * original MultiFactorError and the user's 6-digit code, it resolves the TOTP
 * second factor and then runs the same post-sign-in finalize steps as a normal
 * email sign-in (token-ready wait + profile upsert), returning the mapped user.
 */
export async function completeMfaSignIn(
  error: MultiFactorError,
  code: string,
): Promise<SkillsetUser> {
  const auth = getFirebaseAuth();
  const resolver = getMultiFactorResolver(auth, error);
  const totpHint = resolver.hints.find(
    (hint) => hint.factorId === TOTP_FACTOR_ID,
  );

  if (!totpHint) {
    throw new Error(
      "This account requires a second factor that isn't supported here yet.",
    );
  }

  const assertion = TotpMultiFactorGenerator.assertionForSignIn(
    totpHint.uid,
    code.trim(),
  );
  const credential = await resolver.resolveSignIn(assertion);

  await waitForIdTokenReady(credential.user);
  await runUpsertWithRetry(
    {
      uid: credential.user.uid,
      email: credential.user.email,
      displayName: credential.user.displayName,
      photoURL: credential.user.photoURL,
    },
    "completeMfaSignIn",
  );

  return mapFirebaseUser(credential.user);
}
