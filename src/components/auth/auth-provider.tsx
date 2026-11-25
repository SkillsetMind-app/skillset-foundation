"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { AuthSession } from "@/domain/auth";
import {
  acceptTeacherTerms,
  acceptUserTerms,
  getUserProfile,
} from "@/lib/data/user-profiles";
import {
  getSignupLegalVersions,
  listenToAuthState,
  signOutOfSkillsetMind,
} from "@/lib/auth/supabase-auth";
import { clearSignupTermsMark, hasSignupTermsMark } from "@/lib/auth/signup-terms-mark";
import {
  currentPrivacyVersion,
  currentTeacherTermsVersion,
  currentTermsVersion,
} from "@/lib/legal/versions";
import { captureFirstTouch } from "@/lib/attribution/first-touch";
import { previewRoles, ViewAsBanner } from "@/components/admin/view-as";
import { LegalGateContext } from "@/components/auth/legal-gate-state";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import { isRole, type Role } from "@/lib/permissions";
import { identifyUser, resetUser } from "@/lib/posthog/client";
import { useModalFocus } from "@/lib/a11y/use-modal-focus";

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

// The stored preview as an external store. The server has no sessionStorage,
// and since the session can now arrive already resolved from the server, the
// first client render must agree with that HTML: it reads "no preview" and the
// stored one applies right after hydration.
const viewAsListeners = new Set<() => void>();

function subscribeToViewAs(listener: () => void) {
  viewAsListeners.add(listener);
  return () => {
    viewAsListeners.delete(listener);
  };
}

// Set only while sessionStorage refuses the write: the choice still applies on
// this page, as it did when the role lived in component state.
let viewAsUnstored: Role | null | undefined;

function readViewAs(): Role | null {
  if (viewAsUnstored !== undefined) {
    return viewAsUnstored;
  }
  const stored = window.sessionStorage.getItem(VIEW_AS_KEY);
  return stored && isRole(stored) ? stored : null;
}

const readNoViewAs = () => null;

// A session handed over by the server belongs to the page load it came with.
// A provider that mounts again later (after the root error boundary resets,
// for one) must not start from it: someone may have signed out or switched
// accounts since, and it would show the previous person until the browser's
// own check landed.
const spentSeeds = new WeakSet<AuthSession>();

export function AuthProvider({
  children,
  initialSession = null,
}: {
  children: ReactNode;
  /**
   * The session the server resolved for this page load, or null to let the
   * browser resolve it (see lib/auth/server-session). Only ever a signed-in
   * session: the page then renders signed in from the first HTML.
   */
  initialSession?: AuthSession | null;
}) {
  // Kept from the first render, and only if no earlier provider started from it.
  const [seed] = useState(() =>
    initialSession && !spentSeeds.has(initialSession) ? initialSession : null,
  );
  const [session, setSession] = useState<AuthSession>(
    seed ?? { status: "loading", user: null },
  );
  // What the listener last reported (the seed until it reports anything).
  const reported = useRef<AuthSession | null>(seed);
  const subscription = useRef<ReturnType<typeof listenToAuthState> | null>(null);

  const viewAsRole = useSyncExternalStore(subscribeToViewAs, readViewAs, readNoViewAs);

  const setViewAsRole = useCallback((role: Role | null) => {
    try {
      if (role) {
        window.sessionStorage.setItem(VIEW_AS_KEY, role);
      } else {
        window.sessionStorage.removeItem(VIEW_AS_KEY);
      }
      viewAsUnstored = undefined;
    } catch {
      viewAsUnstored = role;
    }
    for (const listener of viewAsListeners) listener();
  }, []);

  useEffect(() => {
    if (seed) spentSeeds.add(seed);
    // Seeded only while the page still shows exactly what the server sent. If
    // this effect runs again after the listener reported something else, the
    // new listener starts from "loading" like an unseeded one.
    const listener = listenToAuthState((next) => {
      reported.current = next;
      setSession(next);
    }, seed && reported.current === seed ? seed : null);
    subscription.current = listener;
    return () => {
      subscription.current = null;
      listener();
    };
  }, [seed]);

  // Mounted on every page, once per full load: the landing's utm_*/referrer,
  // held for the signup form (see lib/attribution/first-touch).
  useEffect(() => {
    captureFirstTouch();
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
    // The listener also coordinates the snapshot: a stale read must not
    // undo onboarding, logout, an account switch or an MFA requirement.
    if (!subscription.current) throw new Error("Auth subscription is inactive");
    await subscription.current.refreshUser();
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
    return { ...session, user: { ...session.user, roles: previewRoles(viewAsRole) } };
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
      <LegalAcceptanceGate>
        <ViewAsBanner />
        {children}
      </LegalAcceptanceGate>
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

function LegalAcceptanceGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { status, user } = useAuth();
  const pathname = usePathname() ?? "";
  // Keyed by uid so a stale verdict from a previous account can never gate the
  // next one, and so the no-user case is derived (no setState in the effect).
  const [acceptance, setAcceptance] = useState<{
    uid: string;
    general: boolean;
    /** Nothing accepted yet: first acceptance, not an "update". */
    firstTime?: boolean;
    teacher: boolean;
    /** @ of the public profile, for the line that says where it lives. */
    username?: string | null;
  } | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [teacherTermsAccepted, setTeacherTermsAccepted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const uid = status === "authenticated" ? user?.uid ?? null : null;
  const current = uid && acceptance?.uid === uid ? acceptance : null;
  const needsGeneral = Boolean(current?.general);
  const needsTeacher = Boolean(current?.teacher);
  const needsAcceptance = needsGeneral || needsTeacher;
  const firstAcceptance = needsGeneral && Boolean(current?.firstTime);
  const canAccept =
    (!needsGeneral || (termsAccepted && privacyAccepted))
    && (!needsTeacher || teacherTermsAccepted);

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
      // The version changed (or nothing was accepted): only then does the dialog appear.
      let general = profile?.termsVersion !== currentTermsVersion
        || profile?.privacyVersion !== currentPrivacyVersion;
      // The terms ticked at signup. Whoever confirms the email did not yet have
      // a session to write the profile, so the versions wait in the account
      // metadata and are written here, without asking again, with the signup
      // time. Only in the same browser as the signup (the local mark): on another
      // device, or if someone else signed up this email, the dialog asks.
      if ((!profile?.termsVersion || !profile.privacyVersion) && hasSignupTermsMark(checkedUid)) {
        try {
          const signup = await getSignupLegalVersions();
          if (signup.terms === currentTermsVersion && signup.privacy === currentPrivacyVersion && signup.acceptedAt) {
            await acceptUserTerms(checkedUid, profile?.marketingConsent ?? false, signup.acceptedAt);
            general = false;
          }
        } catch {
          // Did not read or did not write: the dialog asks and writes again.
        }
        clearSignupTermsMark();
      }

      if (cancelled) {
        return;
      }

      setAcceptance({
        uid: checkedUid,
        general,
        firstTime: !profile?.termsVersion,
        // Re-acceptance only: a teacher who accepted an older version. The
        // first acceptance belongs to onboarding, which grants the role.
        teacher: Boolean(
          profile?.roles?.includes("teacher")
          && profile.teacherTermsAcceptedAt
          && profile.teacherTermsVersion !== currentTeacherTermsVersion,
        ),
        username: profile?.username ?? null,
      });
      setTermsAccepted(false);
      setPrivacyAccepted(false);
      setTeacherTermsAccepted(false);
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
  const showGate = needsAcceptance && !onExemptRoute;

  // The dialog already covered the page, but Tab escaped to the bell and the account behind
  // the dark overlay, and the screen reader did not know it was a dialog. Focus stays
  // trapped inside and starts on the first checkbox (without checking anything). No
  // Esc, no click outside and no X: accepting is mandatory.
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Focus starts on the checkbox: without the description wired up, the paragraph that explains
  // the dialog was skipped by the screen reader.
  const bodyId = useId();
  useModalFocus(dialogRef, showGate);
  // The welcome tours wait for the dialog (legal-gate-state.ts). Also
  // while it is not yet known whether it will show: a tour opened earlier would sit behind it,
  // already marked as seen. Read-only; nothing here changes when the dialog opens.
  const tourMustWait = showGate || status === "loading" || (uid !== null && current === null);
  useEffect(() => {
    if (showGate) dialogRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
  }, [showGate]);

  async function handleAccept() {
    if (!user || !canAccept) {
      return;
    }

    setIsSaving(true);
    setError("");
    const acceptingUid = user.uid;

    try {
      if (needsGeneral) {
        const profile = await getUserProfile(acceptingUid);
        await acceptUserTerms(acceptingUid, profile?.marketingConsent ?? false);
        // Recorded: a later Teacher Terms failure only re-asks for that one.
        setAcceptance({ uid: acceptingUid, general: false, teacher: needsTeacher, username: current?.username });
      }
      if (needsTeacher) {
        await acceptTeacherTerms(acceptingUid);
      }
      setAcceptance({ uid: acceptingUid, general: false, teacher: false });
    } catch {
      setError("legalAcceptance.error");
    } finally {
      setIsSaving(false);
    }
  }

  const gateWindow = showGate ? (
    <div className="dialog-backdrop fixed inset-0 z-[85] grid place-items-center px-4">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="modal-panel modal-panel-scroll w-full max-w-xl rounded-xl border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-strong)] outline-none"
      >
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
          {t(firstAcceptance ? "legalAcceptance.firstEyebrow" : "legalAcceptance.eyebrow")}
        </p>
        <h2 id={titleId} className="display-title mt-3 text-4xl text-[var(--color-primary)]">
          {t("legalAcceptance.title")}
        </h2>
        <p id={bodyId} className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
          {t(firstAcceptance ? "legalAcceptance.firstBody" : "legalAcceptance.body")}
        </p>

        <div className="mt-5 grid gap-3">
          {needsGeneral ? <>
          <label className="flex gap-3 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              className="mt-1 size-4 accent-[var(--color-primary)]"
            />
            <span>
              {t("legalAcceptance.agreeTerms")}{" "}
              <Link
                href="/legal/terms"
                className="font-semibold text-[var(--color-primary)]! underline-offset-4 hover:underline"
              >
                {t("legalAcceptance.terms")}
              </Link>
              .
            </span>
          </label>

          <label className="flex gap-3 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-3 text-sm leading-6 text-[var(--color-ink-soft)]">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(event) => setPrivacyAccepted(event.target.checked)}
              className="mt-1 size-4 accent-[var(--color-primary)]"
            />
            <span>
              {t("legalAcceptance.agreePrivacy")}{" "}
              <Link
                href="/legal/privacy"
                className="font-semibold text-[var(--color-primary)]! underline-offset-4 hover:underline"
              >
                {t("legalAcceptance.privacy")}
              </Link>
              .
            </span>
          </label>
          </> : null}

          {needsTeacher ? (
            <label className="flex gap-3 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-3 text-sm leading-6 text-[var(--color-ink-soft)]">
              <input
                type="checkbox"
                checked={teacherTermsAccepted}
                onChange={(event) => setTeacherTermsAccepted(event.target.checked)}
                className="mt-1 size-4 accent-[var(--color-primary)]"
              />
              <span>
                {t("legalAcceptance.agreeTeacherTerms")}{" "}
                <Link
                  href="/legal/teacher-terms"
                  className="font-semibold text-[var(--color-primary)]! underline-offset-4 hover:underline"
                >
                  {t("legalAcceptance.teacherTerms")}
                </Link>
                .
              </span>
            </label>
          ) : null}
          {/* Accepting the teacher terms means accepting the public profile. */}
          {needsTeacher ? (
            <p className="text-xs leading-5 text-[var(--color-ink-soft)]">
              {t("onboarding.publicProfileNotice").replace(
                "{handle}",
                () => current?.username || t("onboarding.usernamePlaceholder"),
              )}
            </p>
          ) : null}
        </div>

        {error ? (
          <InlineAlert tone="error" className="mt-4">
            {t(error)}
          </InlineAlert>
        ) : null}

        <button
          type="button"
          disabled={isSaving || !canAccept}
          onClick={handleAccept}
          className="button-solid mt-5 w-full px-4 py-2.5 text-sm"
        >
          {t(isSaving ? "legalAcceptance.saving" : "legalAcceptance.accept")}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <LegalGateContext.Provider value={tourMustWait}>
      {gateWindow}
      {children}
    </LegalGateContext.Provider>
  );
}
