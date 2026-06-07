import { PublicPage } from "@/components/site/public-page";

const publishedAt = "May 11, 2026";

export default function PromiseChangelogPage() {
  return (
    <PublicPage
      eyebrow="Promise changelog"
      title="Every Promise change belongs in public."
      description="The Skillset Creator Promise was published with a public changelog so creators can audit any future policy change before it affects their business."
    >
      <section className="mt-10 rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <h2 className="display-title text-3xl text-[var(--color-primary)]">
          Published on {publishedAt}
        </h2>
        <p className="mt-4 text-sm leading-8 text-[var(--color-ink-soft)]">
          The Skillset Creator Promise was published on {publishedAt}. There
          have been no changes since publication. Any future change will be
          documented here with date, diff, and reason at least 90 days before
          taking effect for existing creators.
        </p>

        <div className="mt-8 rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            Future entry format
          </p>
          <div className="mt-4 grid gap-2 text-sm leading-7 text-[var(--color-ink-soft)]">
            <p>
              <strong className="text-[var(--color-ink)]">
                YYYY-MM-DD — Title of change
              </strong>
            </p>
            <p>What changed: description.</p>
            <p>Why: reasoning.</p>
            <p>Effective from: date for new creators.</p>
            <p>Effective for existing creators: date, always at least 90 days from publication.</p>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
