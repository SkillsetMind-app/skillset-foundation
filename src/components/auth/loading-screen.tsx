"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  getPostAuthRoute,
  getSafeReturnTo,
  getWelcomeRoute,
  parseAuthPathIntent,
} from "@/lib/auth/routing";
import { getUserProfile } from "@/lib/data/user-profiles";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const MINIMUM_LOADING_MS = 1400;
const LONG_WAIT_MS = 5000;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function LoadingScreen() {
  const { t } = useTranslation();
  const { status, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLongWait, setIsLongWait] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    let cancelled = false;
    const longWaitTimer = window.setTimeout(() => {
      if (!cancelled) {
        setIsLongWait(true);
      }
    }, LONG_WAIT_MS);

    async function resolveDestination() {
      const startedAt = performance.now();
      const intent =
        parseAuthPathIntent(searchParams.get("path")) ??
        parseAuthPathIntent(searchParams.get("role"));
      const next = searchParams.get("next");
      const returnTo = getSafeReturnTo(searchParams);
      let destination = "/auth?mode=signin";

      if (status === "mfa_required") {
        // Senha aceita, código ainda não. A tela de login retoma o desafio ao
        // montar; caminho e deep link seguem no query para não se perderem.
        const params = new URLSearchParams();
        if (intent) params.set("path", intent);
        if (returnTo) params.set("returnTo", returnTo);
        const query = params.toString();
        destination = query ? `/login?${query}` : "/login";
      } else if (status === "authenticated" && user) {
        const profile = await getUserProfile(user.uid);

        if (next === "welcome" && !profile?.onboardingCompleted) {
          // The deep link rides along into onboarding instead of stopping here:
          // a first-timer who came from a course page finishes the wizard back
          // on that course.
          destination = getWelcomeRoute(intent, returnTo);
        } else if (returnTo && profile?.onboardingCompleted) {
          // The deep link the sign-in wall captured, carried here by Google
          // sign-in. Onboarded accounts only — first-timers went to /welcome
          // above, the same rule the email login applies.
          destination = returnTo;
        } else if (intent === "teacher" && profile?.roles.includes("teacher")) {
          destination = "/teach";
        } else if (intent === "student") {
          destination = "/learn";
        } else {
          destination = getPostAuthRoute(profile, intent);
        }
      }

      const elapsed = performance.now() - startedAt;
      await wait(Math.max(MINIMUM_LOADING_MS - elapsed, 0));

      if (!cancelled) {
        router.replace(destination);
      }
    }

    void resolveDestination().catch(() => {
      if (!cancelled) {
        setHasError(true);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(longWaitTimer);
    };
  }, [router, searchParams, status, user]);

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-base)] px-5">
      <section className="text-center">
        <div className="mx-auto mb-5 size-14 rounded-full border-[3px] border-[rgba(26,54,93,0.12)] border-t-[var(--color-accent-fg)] motion-safe:animate-spin" />
        <h1 className="display-title text-[22px] font-semibold text-[var(--color-primary)]">
          {t("authFlow.loading.title")}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          {t("authFlow.loading.description")}
        </p>
        {isLongWait ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="button-outline mt-5 px-4 py-2 text-sm"
          >
            {t("authFlow.loading.retry")}
          </button>
        ) : null}
        {hasError ? (
          <p className="mt-4 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {t("authFlow.loading.error")}
          </p>
        ) : null}
      </section>
    </main>
  );
}
