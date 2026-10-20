import { Lock } from "lucide-react";

import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { LogoWordmark } from "@/components/shared/logo-wordmark";

/**
 * Header of the checkout step: the brand, a secure-checkout mark and the
 * language. No site menu and no "create account" button: on this page the
 * only next step is the purchase, as on the checkouts buyers already know.
 */
export function CheckoutHeader({ secureLabel, skipLabel }: { secureLabel: string; skipLabel: string }) {
  return (
    <>
      {/* Como no SiteNav: primeiro elemento focável, pula para o <main id="conteudo">. */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-[var(--color-primary)] focus:shadow-[var(--shadow-soft)]"
      >
        {skipLabel}
      </a>
      <header className="border-b border-[var(--color-line)] bg-[var(--color-base)]">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-8">
          <div className="hidden md:block">
            <LogoWordmark nav />
          </div>
          <div className="md:hidden">
            <LogoWordmark nav variant="mark" />
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-ink-soft)]">
              <Lock aria-hidden="true" size={14} strokeWidth={2} className="text-[var(--color-success-fg)]" />
              {secureLabel}
            </span>
            <LocaleSwitcher variant="compact" />
          </div>
        </div>
      </header>
    </>
  );
}
