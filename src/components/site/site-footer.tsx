import Link from "next/link";

import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { PrivacyChoicesButton } from "@/components/site/privacy-choices-button";
import { BrandName } from "@/components/shared/brand-name";
import { getServerTranslation } from "@/lib/i18n/server";

// Slim 3-column footer. /courses and /how-it-works were removed —
// Courses is the in-app sidebar Marketplace; How it works is a homepage
// anchor (not a standalone page worth promoting twice). Labels are i18n keys
// resolved at render against the request locale.
const footerColumns = [
  {
    titleKey: "footer.platform",
    links: [
      ["footer.pricing", "/pricing"],
      ["footer.forCreators", "/for-creators"],
      ["footer.thePromise", "/promise"],
      ["footer.trust", "/trust"],
    ],
  },
  {
    titleKey: "footer.creator",
    links: [
      ["footer.feesPayouts", "/fees-and-payouts"],
      ["footer.creatorPromise", "/promise"],
      ["footer.teacherTerms", "/legal/teacher-terms"],
    ],
  },
  {
    titleKey: "footer.helpLegal",
    links: [
      ["footer.helpCenter", "/help"],
      ["footer.contactSupport", "/contact"],
      ["footer.termsOfService", "/legal/terms"],
      ["footer.privacyPolicy", "/legal/privacy"],
      ["footer.refundPolicy", "/refund-policy"],
    ],
  },
] as const;

export async function SiteFooter() {
  const { t } = await getServerTranslation();

  return (
    <footer className="mx-auto w-full max-w-7xl px-5 pb-10 pt-12 sm:px-8">
      <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <div>
            <LogoWordmark compact />
            <p className="mt-4 max-w-sm text-sm leading-7 text-[var(--color-ink-soft)]">
              {t("footer.tagline")}
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {footerColumns.map((column) => (
              <div key={column.titleKey}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                  {t(column.titleKey)}
                </p>
                <div className="mt-3 grid gap-2">
                  {column.links.map(([labelKey, href]) => (
                    <Link
                      key={`${column.titleKey}-${href}`}
                      href={href}
                      className="text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-primary)]"
                    >
                      {t(labelKey)}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-5 text-xs leading-6 text-[var(--color-ink-soft)]">
          <span>
            &copy; {new Date().getFullYear()} <BrandName />.
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <PrivacyChoicesButton />
          </div>
          <span>{t("footer.rightsLine")}</span>
        </div>
      </div>
    </footer>
  );
}
