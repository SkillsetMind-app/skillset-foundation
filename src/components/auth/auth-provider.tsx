"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import type { AuthSession } from "@/domain/auth";
import {
  acceptUserTerms,
  getUserProfile,
} from "@/lib/data/user-profiles";
import {
  listenToAuthState,
  mapFirebaseUser,
  signOutOfSkillset,
} from "@/lib/auth/firebase-auth";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  currentPrivacyVersion,
  currentTermsVersion,
} from "@/lib/legal/versions";
import { identifyUser, resetUser } from "@/lib/posthog/client";

type AuthContextValue = AuthSession & {
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession>({
    status: "loading",
    user: null,
  });

  useEffect(() => {
    return listenToAuthState(setSession);
  }, []);

  // PostHog identity binding — keeps analytics session attached to the
  // authenticated uid (and clears it on sign-out so the next visitor
  // doesn't inherit the previous user's distinct_id).
  useEffect(() => {
    if (session.status === "authenticated" && session.user) {
      identifyUser(session.user.uid, {
        email: session.user.email ?? undefined,
        roles: session.user.roles,
        email_verified: session.user.emailVerified,
      });
    } else if (session.status === "unauthenticated") {
      resetUser();
    }
  }, [session.status, session.user]);

  async function refreshUser() {
    const auth = getFirebaseAuth();
    const currentUser = auth.currentUser;

    if (!currentUser) {
      setSession({ status: "unauthenticated", user: null });
      return;
    }

    await currentUser.reload();
    const profile = await getUserProfile(currentUser.uid);

    setSession({
      status: "authenticated",
      user: mapFirebaseUser(currentUser, profile),
    });
  }

  return (
    <AuthContext.Provider
      value={{
        ...session,
        refreshUser,
        signOut: signOutOfSkillset,
      }}
    >
      <LegalAcceptanceGate />
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}

function LegalAcceptanceGate() {
  const { status, user } = useAuth();
  const pathname = usePathname() ?? "";
  // Keyed by uid so a stale verdict from a previous account can never gate the
  // next one, and so the no-user case is derived (no setState in the effect).
  const [acceptance, setAcceptance] = useState<{
    uid: string;
    needsAcceptance: boolean;
  } | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const uid = status === "authenticated" ? user?.uid ?? null : null;
  const needsAcceptance = Boolean(
    uid && acceptance?.uid === uid && acceptance.needsAcceptance,
  );

  // One profile read per signed-in uid — NOT per navigation. The legal
  // versions a profile accepted can't change from client-side route changes,
  // so keying the fetch on uid (instead of pathname) removes a Firestore read
  // from every client-side navigation. Exempt routes are a render-time gate
  // below, which needs no fetch at all.
  useEffect(() => {
    if (!uid) {
      return;
    }

    let cancelled = false;
    const checkedUid = uid;

    async function checkLegalAcceptance() {
      const profile = await getUserProfile(checkedUid);

      if (cancelled) {
        return;
      }

      setAcceptance({
        uid: checkedUid,
        needsAcceptance:
          profile?.termsVersion !== currentTermsVersion
          || profile?.privacyVersion !== currentPrivacyVersion,
      });
      setTermsAccepted(false);
      setPrivacyAccepted(false);
      setError("");
    }

    void checkLegalAcceptance();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  const onExemptRoute =
    pathname.startsWith("/legal")
    || pathname.startsWith("/auth")
    || pathname.startsWith("/login")
    || pathname.startsWith("/loading")
    || pathname.startsWith("/signup")
    || pathname.startsWith("/welcome");

  async function handleAccept() {
    if (!user || !termsAccepted || !privacyAccepted) {
      return;
    }

    setIsSaving(true);
    setError("");

    try {
      const profile = await getUserProfile(user.uid);
      await acceptUserTerms(user.uid, profile?.marketingConsent ?? false);
      setAcceptance({ uid: user.uid, needsAcceptance: false });
    } catch {
      setError("Could not update your legal acceptance. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  if (!needsAcceptance || onExemptRoute) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(12,25,39,0.62)] px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-strong)]">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
          Legal update
        </p>
        <h2 className="display-title mt-3 text-4xl text-[var(--color-primary)]">
          Review Skillset terms to continue.
        </h2>
        <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
          Skillset updated its legal terms. Accept the current Terms of Service
          and Privacy Policy to continue using your account.
        </p>

        <div className="mt-5 grid gap-3">
          <label className="flex gap-3 rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              className="mt-1 size-4 accent-[var(--color-primary)]"
            />
            <span>
              I agree to the current Skillset{" "}
              <Link
                href="/legal/terms"
                className="font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
              >
                Terms of Service
              </Link>
              .
            </span>
          </label>

          <label className="flex gap-3 rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(event) => setPrivacyAccepted(event.target.checked)}
              className="mt-1 size-4 accent-[var(--color-primary)]"
            />
            <span>
              I agree to the current Skillset{" "}
              <Link
                href="/legal/privacy"
                className="font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
              >
                Privacy Policy
              </Link>
              .
            </span>
          </label>
        </div>

        {error ? (
          <p className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={isSaving || !termsAccepted || !privacyAccepted}
          onClick={handleAccept}
          className="button-solid mt-5 w-full px-5 py-3 text-sm disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Accept and continue"}
        </button>
      </div>
    </div>
  );
}
