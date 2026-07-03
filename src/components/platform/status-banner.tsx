"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import type { SkillsetUser } from "@/domain/auth";
import type { UserProfile } from "@/domain/user-profile";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

type BannerState = {
  message: string;
  ctaLabel: string;
  ctaHref: string;
};

export function StatusBanner() {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const pathname = usePathname() ?? "";
  const userId = user?.uid ?? null;
  const [profileState, setProfileState] = useState<{
    uid: string | null;
    profile: UserProfile | null;
  }>({ uid: null, profile: null });

  useEffect(() => {
    if (status !== "authenticated" || !userId) {
      return;
    }

    return subscribeToUserProfile(
      userId,
      (nextProfile) => {
        setProfileState({ uid: userId, profile: nextProfile });
      },
      () => {
        setProfileState({ uid: userId, profile: null });
      },
    );
  }, [status, userId]);

  if (status !== "authenticated" || !user || profileState.uid !== userId) {
    return null;
  }

  const banner = getAccountBanner(user, profileState.profile, pathname, t);

  if (!banner) {
    return null;
  }

  return (
    <div className="account-status-banner sticky top-0 z-[35] min-h-12 px-4 py-2">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-3 text-center text-sm font-semibold">
        <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.8} />
        <span>{banner.message}</span>
        <Link
          href={banner.ctaHref}
          className="text-xs font-bold underline underline-offset-4"
        >
          {banner.ctaLabel}
        </Link>
      </div>
    </div>
  );
}

function getAccountBanner(
  user: SkillsetUser,
  profile: UserProfile | null,
  pathname: string,
  t: (key: string) => string,
): BannerState | null {
  const roles = profile?.roles?.length ? profile.roles : user.roles;

  if (user.emailVerified === false) {
    return {
      message: t("platform.banner.verifyEmail"),
      ctaLabel: t("platform.banner.resendVerification"),
      ctaHref: "/account?tab=security",
    };
  }

  if (roles.includes("teacher") && !profile?.teacherTermsAcceptedAt) {
    return {
      message: t("platform.banner.acceptTerms"),
      ctaLabel: t("platform.banner.acceptTermsCta"),
      ctaHref: "/onboarding?path=teacher",
    };
  }

  const teacherNeedsStripeSetup =
    roles.includes("teacher")
    && (
      !profile?.stripeConnectChargesEnabled
      || !profile?.stripeConnectPayoutsEnabled
    );

  const payoutContext =
    pathname.startsWith("/teach") || pathname.startsWith("/account/payments");

  if (teacherNeedsStripeSetup && payoutContext) {
    return {
      message: t("platform.banner.connectPayouts"),
      ctaLabel: t("platform.banner.connectPayoutsCta"),
      ctaHref: "/account/payments#stripe-connect",
    };
  }

  return null;
}
