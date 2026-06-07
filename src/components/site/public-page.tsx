import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";

type PublicPageProps = {
  eyebrow: string;
  title: string;
  description: string;
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
            <h1 className="display-title mt-4 text-5xl leading-none text-[var(--color-primary)] sm:text-6xl">
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
