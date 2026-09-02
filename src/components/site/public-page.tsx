import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";

type PublicPageProps = {
  eyebrow: string;
  title: string;
  /** Texto corrido; aceita nós para páginas que precisam de um link no meio. */
  description: ReactNode;
  children: ReactNode;
};

export function PublicPage({
  eyebrow,
  title,
  description,
  children,
}: PublicPageProps) {
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-7xl px-6 py-12 sm:px-8 sm:py-16">
        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {eyebrow}
            </p>
            {/* .page-title (globals.css): clamp em vez de text-6xl fixo — 60px
                não cabiam num celular de 360px. */}
            <h1 className="display-title page-title mt-4 text-[var(--color-primary)]">
              {title}
            </h1>
          </div>
          <p className="text-sm leading-8 text-[var(--color-ink-soft)]">
            {description}
          </p>
        </section>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
