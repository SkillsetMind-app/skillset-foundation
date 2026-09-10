import Link from "next/link";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("activationCheckout.returnTitle");
}

/**
 * Post-checkout landing. Deliberately does NOT decide whether the fee is paid:
 * the Stripe webhook stamps `users.activation_fee_paid_at` and the SQL publish
 * gate reads that column, so reporting success from a return URL a creator can
 * type by hand would be a lie the database might not agree with.
 */
export default async function TeachActivateReturnPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("activationCheckout.returnTitle")} compact>
        <div className="rounded-[14px] border fine-rule bg-white p-8 shadow-[var(--shadow-soft)]">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t("activationCheckout.thanks")}
          </p>
          <h2 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
            {t("activationCheckout.confirming")}
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("activationCheckout.returnBody")}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/teach/builder" className="button-solid px-4 py-2.5 text-sm">
              {t("activationCheckout.backToCourseStudio")}
            </Link>
            <Link href="/support" className="button-outline px-4 py-2.5 text-sm">
              {t("activationCheckout.support")}
            </Link>
          </div>
        </div>
      </PlatformShell>
    </ProtectedSurface>
  );
}
