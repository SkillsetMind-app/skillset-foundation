"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { AuthSession } from "@/domain/auth";
import {
  acceptUserTerms,
  getUserProfile,
} from "@/lib/data/user-profiles";
import {
  getCurrentSkillsetUser,
  listenToAuthState,
  signOutOfSkillsetMind,
} from "@/lib/auth/supabase-auth";
import {
  currentPrivacyVersion,
  currentTermsVersion,
} from "@/lib/legal/versions";
import { ViewAsBanner } from "@/components/admin/view-as";
import { isRole, type Role } from "@/lib/permissions";
import { identifyUser, resetUser } from "@/lib/posthog/client";

type AuthContextValue = AuthSession & {
  refreshUser: () => Promise<void>;
  signOut: () => Promise<void>;
  /** The role an admin is previewing the product as, or null. */
  viewAsRole: Role | null;
  setViewAsRole: (role: Role | null) => void;
  /** True when the SIGNED-IN account is an admin, ignoring any preview. */
  isRealAdmin: boolean;
};

// sessionStorage, not a cookie: a preview is a look around, and it should die
// with the tab rather than follow someone back tomorrow wondering why half the
// product vanished.
const VIEW_AS_KEY = "skillsetmind.viewAs";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession>({
    status: "loading",
    user: null,
  });

  // Read once during the first render rather than in an effect: an effect would
  // paint the un-previewed product first and then swap it, and this base treats
  // setState-inside-an-effect as an error. Safe against hydration mismatch
  // because the session is still loading on the first client render, so the
  // banner is absent on both sides regardless of what is stored.
  const [viewAsRole, setViewAsRoleState] = useState<Role | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const stored = window.sessionStorage.getItem(VIEW_AS_KEY);
    return stored && isRole(stored) ? stored : null;
  });

  const setViewAsRole = useCallback((role: Role | null) => {
    setViewAsRoleState(role);
    if (role) {
      window.sessionStorage.setItem(VIEW_AS_KEY, role);
    } else {
      window.sessionStorage.removeItem(VIEW_AS_KEY);
    }
  }, []);

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
    // getUser() hits the server, so email_confirmed_at/roles reflect the latest
    // state (the Supabase equivalent of Firebase's currentUser.reload()).
    const user = await getCurrentSkillsetUser();

    setSession(
      user
        ? { status: "authenticated", user }
        : { status: "unauthenticated", user: null },
    );
  }

  const isRealAdmin = session.user?.roles?.includes("admin") ?? false;

  /**
   * What the rest of the app sees.
   *
   * A preview can only ever NARROW: it applies solely when the signed-in
   * account really is an admin, and it replaces the role set outright, so it
   * can never hand anyone a permission they did not already have. Every write
   * is still gated server-side by RLS and by is_admin() in SQL, which know
   * nothing about this and cannot be fooled by it — the preview changes what
   * the interface offers, never what the database allows.
   *
   * Reading isRealAdmin from the untouched session (not the previewed one) is
   * what stops a preview from being able to hide the way back out of itself.
   */
  const previewSession = useMemo<AuthSession>(() => {
    if (!isRealAdmin || !viewAsRole || !session.user) {
      return session;
    }
    return { ...session, user: { ...session.user, roles: [viewAsRole] } };
  }, [session, isRealAdmin, viewAsRole]);

  return (
    <AuthContext.Provider
      value={{
        ...previewSession,
        refreshUser,
        signOut: signOutOfSkillsetMind,
        viewAsRole: isRealAdmin ? viewAsRole : null,
        setViewAsRole,
        isRealAdmin,
      }}
    >
      <LegalAcceptanceGate />
      <ViewAsBanner />
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
          Review SkillsetMind terms to continue.
        </h2>
        <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
          SkillsetMind updated its legal terms. Accept the current Terms of Service
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
              I agree to the current SkillsetMind{" "}
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
              I agree to the current SkillsetMind{" "}
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
          <p className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={isSaving || !termsAccepted || !privacyAccepted}
          onClick={handleAccept}
          className="button-solid mt-5 w-full px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Accept and continue"}
        </button>
      </div>
    </div>
  );
}
