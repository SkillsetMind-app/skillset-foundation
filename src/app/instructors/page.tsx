import Link from "next/link";

import { SiteNav } from "@/components/site/site-nav";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Instructors",
  description:
    "Independent experts publishing reviewed professional courses on Skillset. The first cohort is being onboarded.",
  path: "/instructors",
});

export default function InstructorsPage() {
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-3xl px-6 py-20 sm:px-8 sm:py-28">
        <div className="rounded-[18px] border border-dashed border-[rgba(26,54,93,0.18)] bg-[var(--color-surface-soft)] p-10 text-center sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Instructors joining
          </p>
          <h1 className="display-title mt-4 text-4xl leading-tight text-[var(--color-primary)] sm:text-5xl">
            Skillset&rsquo;s first instructors are being onboarded.
          </h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
            Independent experts are completing teacher onboarding and course
            review now. Verified instructors will appear here once their
            programs are published.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/auth?mode=signup&path=teacher"
              className="button-solid px-5 py-3 text-sm"
            >
              Apply to teach
            </Link>
            <Link href="/promise" className="button-outline px-5 py-3 text-sm">
              Read the Promise
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
