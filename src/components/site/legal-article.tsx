import type { ReactNode } from "react";

import { SiteNav } from "@/components/site/site-nav";
import { SiteFooter } from "@/components/site/site-footer";

// Shared chrome for the long-form legal documents (/legal/*). Content stays in
// each page file; this only owns the visual frame so the three documents can't
// drift apart visually.

type LegalArticleProps = {
  kicker: string;
  title: string;
  intro: ReactNode;
  effectiveDate: string;
  children: ReactNode;
};

export function LegalArticle({
  kicker,
  title,
  intro,
  effectiveDate,
  children,
}: LegalArticleProps) {
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-8">
        <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-8 shadow-[var(--shadow-soft)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {kicker}
          </p>
          <h1 className="display-title mt-4 text-5xl leading-none text-[var(--color-primary)] sm:text-6xl">
            {title}
          </h1>
          <div className="mt-6 text-sm leading-8 text-[var(--color-ink-soft)]">
            {intro}
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
            Effective {effectiveDate}
          </p>
        </section>

        <section className="mt-6 space-y-10 rounded-[18px] border border-[var(--color-line)] bg-white p-8 text-sm leading-8 text-[var(--color-ink-soft)] shadow-[var(--shadow-soft)] sm:p-10">
          {children}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
        {heading}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

// Visible placeholder for facts the founder still needs to confirm (entity
// name, jurisdiction, addresses). Rendering them loudly beats shipping a
// document that silently invents them.
export function Define({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-[var(--color-warning-soft)] px-1 py-0.5 font-semibold text-[var(--color-warning-fg)]">
      [{children}]
    </mark>
  );
}
