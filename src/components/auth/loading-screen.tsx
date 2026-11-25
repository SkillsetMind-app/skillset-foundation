"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  getAuthRoute,
  getOnboardedReturnTo,
  getPostAuthRoute,
  getSafeReturnTo,
  getWelcomeRoute,
  parseAuthPathIntent,
} from "@/lib/auth/routing";
import { getUserProfile } from "@/lib/data/user-profiles";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// Only long enough so the screen does not flash when the destination is ready right away. It was
// 1400ms on every login and every return from Google, even with the destination ready.
const MINIMUM_LOADING_MS = 400;
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
    const timer = window.setTimeout(() => setIsLongWait(true), LONG_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (status === "loading") {
      return;
    }

    let cancelled = false;

    async function resolveDestination() {
      const startedAt = performance.now();
      const intent =
        parseAuthPathIntent(searchParams.get("path")) ??
        parseAuthPathIntent(searchParams.get("role"));
      const next = searchParams.get("next");
      const returnTo = getSafeReturnTo(searchParams);
      let destination = getAuthRoute("signin", intent, returnTo);

      if (status === "mfa_required") {
        // Password accepted, code not yet. The login screen resumes the challenge on
        // mount; path and deep link stay in the query so they are not lost.
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
        } else {
          // The deep link the sign-in wall captured, carried here by Google
          // sign-in. Onboarded accounts only — first-timers went to /welcome
          // above, the same rule the email login applies. A plan picked on
          // /pricing opens its card screen only for a teacher with no plan yet.
          destination =
            (profile?.onboardingCompleted
              ? getOnboardedReturnTo(profile, returnTo, intent)
              : null) ?? getPostAuthRoute(profile, intent);
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
    };
  }, [router, searchParams, status, user]);

  return (
    <SkillsetSpinner title={t("authFlow.loading.title")}>
      {isLongWait || hasError ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="button-outline mt-5 px-4 py-2 text-sm"
        >
          {t("authFlow.loading.retry")}
        </button>
      ) : null}
      {hasError ? (
        // text-left: the wait screen centers everything, but the notice has an icon on the
        // left; centered, the second line detached from it.
        <InlineAlert tone="error" className="mt-4 text-left">
          {t("authFlow.loading.error")}
        </InlineAlert>
      ) : null}
    </SkillsetSpinner>
  );
}
