"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
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

  const banner = getAccountBanner(user, profileState.profile, pathname);

  if (!banner) {
    return null;
  }

  return (
    <div className="sticky top-0 z-[35] min-h-12 border-b border-[#f59e0b] bg-[linear-gradient(90deg,#fef3c7_0%,#fde68a_100%)] px-4 py-2 text-[#78350f]">
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
): BannerState | null {
  const roles = profile?.roles?.length ? profile.roles : user.roles;

  if (user.emailVerified === false) {
    return {
      message: "Verify your email to secure your account and enable creator tools.",
      ctaLabel: "Resend verification",
      ctaHref: "/account?tab=security",
    };
  }

  if (roles.includes("teacher") && !profile?.teacherTermsAcceptedAt) {
    return {
      message: "Accept the Teacher Terms to publish courses.",
      ctaLabel: "Accept terms",
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
      message: "Connect payouts before selling paid courses. Free and draft courses do not need this yet.",
      ctaLabel: "Connect payouts",
      ctaHref: "/account/payments#stripe-connect",
    };
  }

  return null;
}
