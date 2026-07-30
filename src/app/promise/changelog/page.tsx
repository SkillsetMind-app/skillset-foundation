import { PublicPage } from "@/components/site/public-page";

const publishedAt = "May 11, 2026";

export default function PromiseChangelogPage() {
  return (
    <PublicPage
      eyebrow="Promise changelog"
      title="Every Promise change belongs in public."
      description="The SkillsetMind Creator Promise was published with a public changelog so creators can audit any future policy change before it affects their business."
    >
      <section className="mt-10 rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <h2 className="display-title text-3xl text-[var(--color-primary)]">
          Published on {publishedAt}
        </h2>
        <p className="mt-4 text-sm leading-8 text-[var(--color-ink-soft)]">
          The SkillsetMind Creator Promise was published on {publishedAt}. One
          change has been made since publication, recorded below. Any future
          change will be documented here with date, diff, and reason at least 90
          days before taking effect for existing creators.
        </p>

        <div className="mt-8 rounded-[14px] border border-[var(--color-line)] bg-white p-5">
          <p className="text-sm font-bold text-[var(--color-ink)]">
            2026-07-24 — Promise 05 replaced: &ldquo;Funds protection by
            contract&rdquo; became &ldquo;We never hold your money&rdquo;
          </p>
          <div className="mt-4 grid gap-2 text-sm leading-7 text-[var(--color-ink-soft)]">
            <p>
              What changed: course payments moved to Stripe direct charges. The
              buyer is now charged on the educator&apos;s own Stripe account, the
              educator is the merchant of record, and SkillsetMind takes its
              platform fee at the moment of the charge. The previous 30-day
              platform clearing period was removed, because SkillsetMind no
              longer receives or holds sale proceeds at all. Affiliate and
              co-producer revenue splits were removed with it: a platform that
              never touches the money cannot divide it.
            </p>
            <p>
              Why: a promise to protect funds held by SkillsetMind is weaker than
              not holding them. Removing custody removes the failure mode the
              old promise was written to cover.
            </p>
            <p>Effective from: July 24, 2026 for new creators.</p>
            <p>
              Effective for existing creators: July 24, 2026. The 90-day notice
              period did not apply, because the change took effect while no
              creator was selling under the previous promise, and because it
              removed a platform hold rather than adding one.
            </p>
          </div>
        </div>

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
