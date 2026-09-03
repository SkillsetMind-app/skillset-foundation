"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
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

  const banner = getAccountBanner(user, profileState.profile, t);

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

  // O aviso do Stripe MOROU aqui, como faixa amarela fixa em todo /teach: ela
  // nunca se ia até a conta ficar conectada, então a pessoa passava semanas com
  // um alerta permanente no topo — e alerta permanente deixa de ser alerta.
  // Agora ele vive em dois lugares onde tem consequência: um passo da lista
  // "Get ready for your first sale", na Home do professor, e uma linha discreta
  // e dispensável nas telas de venda (ver `stripe-connect-notice.tsx`). Os dois
  // somem sozinhos quando a conta conecta.
  return null;
}
