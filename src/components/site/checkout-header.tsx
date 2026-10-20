import { Lock } from "lucide-react";

import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { LogoWordmark } from "@/components/shared/logo-wordmark";

/**
 * Header of the checkout step: the brand, a secure-checkout mark and the
 * language. No site menu and no "create account" button: on this page the
 * only next step is the purchase, as on the checkouts buyers already know.
 */
export function CheckoutHeader({ secureLabel }: { secureLabel: string }) {
  return (
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
  );
}
