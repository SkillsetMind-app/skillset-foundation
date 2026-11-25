"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

// The Stripe account not yet connected, spoken about on the sales screens.
//
// It used to be a yellow banner fixed at the top of ALL of /teach (status-banner.tsx), which
// only went away when the account connected — days or weeks of a permanent alert, which
// is the same as no alert. Here it is a single line, only where money is discussed,
// that the person dismisses and does not see again in this session. It disappears by itself as soon as
// charges and payouts are enabled.

const DISMISS_KEY = "skillset:stripe-connect-notice-dismissed";

const EMPTY_SUBSCRIBE = () => () => {};

// The notice waited for the profile (~0.3 s after the sales list) and, when it showed up,
// pushed the list 117px down on a phone. The last state read for this
// person is kept on this device: whoever has not connected yet sees the notice from the
// first frame; if the account connected since the last visit, it leaves when the
// profile arrives (only once).
const LAST_KNOWN_KEY = "skillset:stripe-connect-notice-last";

function readLastKnown(userId: string | null): boolean | null {
  if (!userId) return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(LAST_KNOWN_KEY) ?? "null");
    return saved?.uid === userId && typeof saved.ready === "boolean" ? saved.ready : null;
  } catch {
    return null;
  }
}

function saveLastKnown(userId: string, ready: boolean) {
  try {
    window.localStorage.setItem(LAST_KNOWN_KEY, JSON.stringify({ uid: userId, ready }));
  } catch {
    // ponytail: storage blocked: the notice just waits for the profile, as before.
  }
}

// Reads the "already dismissed" mark without set-state-in-effect (the house style forbids it) and without
// hydration mismatch: the server snapshot is `true`, so nothing is
// drawn on the SSR and the real value comes in on hydration. No subscription — the mark
// only changes through dismiss(), which already has its own state. sessionStorage throws in a
// browser with site data blocked; a dismissible notice is no reason
// to bring down the sales screen.
function useDismissedThisSession() {
  return useSyncExternalStore(
    EMPTY_SUBSCRIBE,
    () => {
      try {
        return window.sessionStorage.getItem(DISMISS_KEY) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
}

export function StripeConnectNotice() {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const userId = user?.uid ?? null;
  const [payoutsReady, setPayoutsReady] = useState<boolean | null>(null);
  // The profile read failed: with no read in this visit, the last visit's mark
  // is not valid either (the account may have connected on another device).
  const [readFailed, setReadFailed] = useState(false);
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = useDismissedThisSession() || dismissedNow;
  const lastKnown = useSyncExternalStore(EMPTY_SUBSCRIBE, () => readLastKnown(userId), () => null);

  useEffect(() => {
    if (status !== "authenticated" || !userId) {
      return;
    }

    return subscribeToUserProfile(
      userId,
      (profile) => {
        const ready = Boolean(
          profile?.stripeConnectChargesEnabled && profile?.stripeConnectPayoutsEnabled,
        );
        saveLastKnown(userId, ready);
        setReadFailed(false);
        setPayoutsReady(ready);
      },
      () => {
        setReadFailed(true);
        setPayoutsReady(null);
      },
    );
  }, [status, userId]);

  // `null` = we do not know yet. We do not claim that setup is missing before reading
  // the profile (neither in this visit nor in a previous one): a notice that flashes and goes away is
  // worse than none.
  if (dismissed || readFailed || (payoutsReady ?? lastKnown) !== false) {
    return null;
  }

  function dismiss() {
    setDismissedNow(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Without sessionStorage the notice comes back on the next load. Acceptable.
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--color-line)] pb-3 text-sm text-[var(--color-ink-soft)]"
    >
      <p className="min-w-0 flex-1">
        {t("platform.banner.connectPayouts")}{" "}
        <Link
          href="/account/payments#stripe-connect"
          className="font-bold text-[var(--color-primary)]! underline underline-offset-4"
        >
          {t("platform.banner.connectPayoutsCta")}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("platform.banner.dismissNotice")}
        className="grid size-11 shrink-0 place-items-center rounded-full text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-strong)] hover:text-[var(--color-ink)]"
      >
        <X aria-hidden="true" size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
