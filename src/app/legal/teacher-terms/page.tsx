import { SiteNav } from "@/components/site/site-nav";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Teacher Terms",
  description:
    "The terms that govern teaching and payouts on Skillset.",
  path: "/legal/teacher-terms",
});

export default function TeacherTermsPage() {
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-8">
        <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-8 shadow-[var(--shadow-soft)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Teacher Terms
          </p>
          <h1 className="display-title mt-4 text-6xl leading-none text-[var(--color-primary)]">
            Publish with quality and trust.
          </h1>
          <div className="mt-6 grid gap-4 text-sm leading-8 text-[var(--color-ink-soft)]">
            <p>
              Skillset gives instructors tools to build courses, communities,
              live sessions, and paid learning products. Instructors are
              responsible for the accuracy, originality, legality, and learner
              safety of all materials they upload.
            </p>
            <p>
              Teacher access is self-service for verified accounts, but course
              marketplace visibility is controlled by Skillset review. Courses
              may be returned for changes, paused, or removed if they fail
              quality, trust, payment, or content standards.
            </p>
            <p>
              Instructors may not upload content they do not own, misleading
              credential claims, unsafe advice, malware, private learner data,
              or material that violates applicable law or platform policy.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
