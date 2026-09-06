"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import Link from "next/link";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="page-shell flex min-h-screen items-center justify-center px-6">
      <div className="surface-card max-w-2xl rounded-[18px] p-8 text-center sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-accent-fg)]">
          {t("publicPages.notFound.eyebrow")}
        </p>
        <h1 className="display-title page-title mt-4 text-[var(--color-ink)]">
          {t("publicPages.notFound.title")}
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("publicPages.notFound.body")}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="button-solid px-4 py-2.5 text-sm"
          >
            {t("publicPages.notFound.home")}
          </Link>
          {/* Era "Open platform overview" → /platform, uma vitrine interna.
              Quem cai num 404 quer conteúdo: o catálogo. */}
          <Link
            href="/courses"
            className="button-outline px-4 py-2.5 text-sm"
          >
            {t("publicPages.notFound.courses")}
          </Link>
        </div>
      </div>
    </main>
  );
}
