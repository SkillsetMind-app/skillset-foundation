"use client";

import { ArrowRight, LayoutDashboard } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { getPrimaryWorkspaceHref } from "@/lib/auth/routing";

// Client island inside the (server-rendered) marketing hero. Guests and
// still-loading sessions see the conversion CTAs; a signed-in visitor instead
// gets a direct path to their workspace so they're never stranded on the home
// page.
export function HeroCtas() {
  const { status, user } = useAuth();
  const { t } = useTranslation();

  if (status === "authenticated" && user) {
    return (
      <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
        <Link
          href={getPrimaryWorkspaceHref(user)}
          className="button-solid-light"
        >
          <LayoutDashboard aria-hidden="true" size={16} strokeWidth={1.9} />
          {t("home.hero.ctaDashboard")}
        </Link>
        <Link href="/courses" className="button-outline-light">
          {t("home.hero.ctaBrowse")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-center gap-3 lg:justify-start">
      <Link
        href="/auth?mode=signup&path=teacher"
        className="button-solid-light group"
      >
        {t("home.hero.ctaTeach")}
        <ArrowRight
          aria-hidden="true"
          size={16}
          strokeWidth={2}
          className="transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </Link>
      <Link href="/pricing" className="button-outline-light">
        {t("home.hero.ctaPaid")}
      </Link>
    </div>
  );
}
