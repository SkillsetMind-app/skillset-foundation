import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { BrandPortrait } from "@/components/shared/brand-portrait";
import { LogoWordmark } from "@/components/shared/logo-wordmark";

export function AuthFrame({ children, homeLabel }: { children: ReactNode; homeLabel: string }) {
  return (
    <main className="auth-split">
      <div className="auth-form-col">
        <header className="auth-topbar">
          <LogoWordmark nav />
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/" aria-label={homeLabel} className="auth-home-link">
              <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.8} />
              <span className="hidden sm:inline">{homeLabel}</span>
            </Link>
            <LocaleSwitcher />
          </div>
        </header>
        <section className="auth-main">
          <div className="auth-card">{children}</div>
        </section>
      </div>
      <aside className="auth-aside" aria-hidden="true">
        {/* Keep the same still, original portrait used by the homepage. */}
        <BrandPortrait
          imageClassName="pointer-events-none object-cover object-[75%_center]"
          sizes="(min-width: 1024px) 60vw, 0px"
          priority
        />
      </aside>
    </main>
  );
}
