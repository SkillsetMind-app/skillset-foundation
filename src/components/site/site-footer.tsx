import Link from "next/link";

import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { PrivacyChoicesButton } from "@/components/site/privacy-choices-button";
import { BrandName } from "@/components/shared/brand-name";
import { getServerTranslation } from "@/lib/i18n/server";

// Slim 3-column footer. /how-it-works IS listed: the standalone page exists and
// was otherwise orphaned (the homepage only has a `#how-it-works` anchor, which
// is a different surface), so the footer is its single entry point —
// deliberately not the top nav. /courses, /instructors and /about are public
// pages the top nav also skips, so the footer is where a visitor finds them.
// /promise appears once: it used to be listed twice under two names ("The
// Promise" and "Creator Promise"). Labels are i18n keys resolved against the
// request locale.
const footerColumns = [
  {
    titleKey: "footer.platform",
    links: [
      ["footer.courses", "/courses"],
      ["footer.instructors", "/instructors"],
      ["footer.howItWorks", "/how-it-works"],
      ["footer.pricing", "/pricing"],
      ["footer.thePromise", "/promise"],
      ["footer.trust", "/trust"],
      ["footer.about", "/about"],
    ],
  },
  {
    titleKey: "footer.creator",
    links: [
      ["footer.forCreators", "/for-creators"],
      ["footer.feesPayouts", "/fees-and-payouts"],
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
    // Faixa de largura total com filete no topo. Antes era um cartão com sombra
    // dentro da página — um bloco que flutuava sobre o fundo e disputava
    // atenção com o conteúdo, em vez de fechar a página.
    <footer className="mt-16 w-full border-t border-[var(--color-line)]">
      <div className="mx-auto w-full max-w-7xl px-5 pb-10 pt-12 sm:px-8">
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
            <LocaleSwitcher />
          </div>
          <span>{t("footer.rightsLine")}</span>
        </div>
      </div>
    </footer>
  );
}
