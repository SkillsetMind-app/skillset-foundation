import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";

type PublicPageProps = {
  eyebrow: string;
  title: string;
  /** Running text; accepts nodes for pages that need a link in the middle. */
  description: ReactNode;
  /**
   * Long continuous-reading document (legal, policy): the column shrinks
   * to ~72 characters and the header stacks, because the two-column grid
   * only makes sense when there is spare width.
   */
  reading?: boolean;
  children: ReactNode;
};

export function PublicPage({
  eyebrow,
  title,
  description,
  reading = false,
  children,
}: PublicPageProps) {
  return (
    <div className="page-shell">
      <SiteNav />
      <main
        id="conteudo"
        className={`mx-auto w-full px-5 py-12 sm:px-8 sm:py-16 ${
          reading ? "max-w-[72ch]" : "max-w-7xl"
        }`}
      >
        <section
          className={
            reading
              ? "grid gap-6"
              : "grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center"
          }
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {eyebrow}
            </p>
            {/* .page-title (globals.css): clamp instead of fixed text-6xl — 60px
                did not fit on a 360px phone. */}
            <h1 className="display-title page-title mt-4 text-[var(--color-primary)]">
              {title}
            </h1>
          </div>
          {/* <div> and not <p>: the long documents already pass the introduction in
              paragraphs, and <p> inside <p> is invalid HTML.
              16px/28px: it was 14px with a 32px line height (2.3x), which opened a
              gap between the lines and read as loose text beside the title. */}
          <div className="text-base leading-relaxed text-[var(--color-ink-soft)]">
            {description}
          </div>
        </section>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
