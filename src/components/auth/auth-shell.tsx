import Link from "next/link";
import type { ReactNode } from "react";

import { LogoWordmark } from "@/components/shared/logo-wordmark";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
};

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: AuthShellProps) {
  return (
    <main className="page-shell min-h-screen">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl gap-8 px-5 py-6 sm:px-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
        <section className="rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)] sm:p-7">
          <LogoWordmark compact />
          <p className="mt-10 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {eyebrow}
          </p>
          <h1 className="display-title mt-3 text-5xl leading-tight text-[var(--color-primary)] sm:text-6xl">
            {title}
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">
            {description}
          </p>
          <div className="mt-8 grid gap-3 text-sm text-[var(--color-ink-soft)]">
            <div className="rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4">
              <strong className="text-[var(--color-ink)]">Learners</strong> access courses,
              events, community, progress, and certificates.
            </div>
            <div className="rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4">
              <strong className="text-[var(--color-ink)]">Educators</strong> build courses,
              manage students, schedule sessions, and publish with review.
            </div>
          </div>
        </section>

        <section className="rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)] sm:p-7">
          {children}
          <div className="mt-6 border-t border-[var(--color-line)] pt-5 text-sm text-[var(--color-ink-soft)]">
            {footer}
          </div>
          <Link
            href="/"
            className="mt-6 inline-flex text-sm font-semibold text-[var(--color-primary)]"
          >
            Back to homepage
          </Link>
        </section>
      </div>
    </main>
  );
}
