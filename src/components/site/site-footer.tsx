import Link from "next/link";

import { LogoWordmark } from "@/components/shared/logo-wordmark";
import { PrivacyChoicesButton } from "@/components/site/privacy-choices-button";

// Slim 3-column footer. /courses and /how-it-works were removed —
// Courses is the in-app sidebar Marketplace; How it works is a homepage
// anchor (not a standalone page worth promoting twice).
const footerColumns = [
  {
    title: "Platform",
    links: [
      ["Pricing", "/pricing"],
      ["For creators", "/for-creators"],
      ["The Promise", "/promise"],
      ["Trust", "/trust"],
    ],
  },
  {
    title: "Creator",
    links: [
      ["Fees and payouts", "/fees-and-payouts"],
      ["Creator Promise", "/promise"],
      ["Teacher terms", "/legal/teacher-terms"],
    ],
  },
  {
    title: "Help & legal",
    links: [
      ["Help center", "/help"],
      ["Contact support", "/contact"],
      ["Terms of service", "/legal/terms"],
      ["Privacy policy", "/legal/privacy"],
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-7xl px-5 pb-10 pt-12 sm:px-8">
      <div className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
          <div>
            <LogoWordmark compact />
            <p className="mt-4 max-w-sm text-sm leading-7 text-[var(--color-ink-soft)]">
              The course platform for psychologists, therapists, and
              personal-development coaches — reviewed quality, transparent
              payouts, verifiable credentials.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {footerColumns.map((column) => (
              <div key={column.title}>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                  {column.title}
                </p>
                <div className="mt-3 grid gap-2">
                  {column.links.map(([label, href]) => (
                    <Link
                      key={`${column.title}-${href}`}
                      href={href}
                      className="text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-primary)]"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line)] pt-5 text-xs leading-6 text-[var(--color-ink-soft)]">
          <span>&copy; {new Date().getFullYear()} Skillset.</span>
          <PrivacyChoicesButton />
          <span>
            Built for course-first learning, transparent payouts, trusted
            student progress.
          </span>
        </div>
      </div>
    </footer>
  );
}
