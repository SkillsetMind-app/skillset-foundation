import { PublicPage } from "@/components/site/public-page";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

const copy = "promiseChangelog";
// Newest first. `{date}` in a line becomes the entry's own date.
const entries = [
  { date: "2026-09-15", title: "change2Title", lines: ["change2WhatChanged", "change2Why", "change2Effective"] },
  { date: "2026-07-24", title: "changeTitle", lines: ["whatChanged", "why", "effectiveNew", "effectiveExisting"] },
];

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t(`${copy}.title`),
    description: t(`${copy}.description`),
    path: "/promise/changelog",
  });
}

export default async function PromiseChangelogPage() {
  const { locale, t } = await getServerTranslation();
  const dateFormat = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const publishedAt = dateFormat.format(new Date("2026-05-11T00:00:00Z"));
  return (
    <PublicPage
      eyebrow={t(`${copy}.eyebrow`)}
      title={t(`${copy}.title`)}
      description={t(`${copy}.description`)}
    >
      <section className="mt-10 rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <h2 className="display-title text-3xl text-[var(--color-primary)]">
          {t(`${copy}.publishedOn`).replace("{date}", () => publishedAt)}
        </h2>
        <p className="mt-4 text-sm leading-8 text-[var(--color-ink-soft)]">
          {t(`${copy}.publication`).replace("{date}", () => publishedAt)}
        </p>

        {entries.map((entry) => {
          const effectiveAt = dateFormat.format(new Date(`${entry.date}T00:00:00Z`));
          return (
            <div key={entry.date} className="mt-8 rounded-[14px] border border-[var(--color-line)] bg-white p-5">
              <p className="text-sm font-bold text-[var(--color-ink)]">
                {entry.date} — {t(`${copy}.${entry.title}`)}
              </p>
              <div className="mt-4 grid gap-2 text-sm leading-7 text-[var(--color-ink-soft)]">
                {entry.lines.map((line) => (
                  <p key={line}>{t(`${copy}.${line}`).replace("{date}", () => effectiveAt)}</p>
                ))}
              </div>
            </div>
          );
        })}

        <div className="mt-8 rounded-[14px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
            {t(`${copy}.futureFormat`)}
          </p>
          <div className="mt-4 grid gap-2 text-sm leading-7 text-[var(--color-ink-soft)]">
            <p>
              <strong className="text-[var(--color-ink)]">
                YYYY-MM-DD — {t(`${copy}.futureTitle`)}
              </strong>
            </p>
            <p>{t(`${copy}.futureChange`)}</p>
            <p>{t(`${copy}.futureWhy`)}</p>
            <p>{t(`${copy}.futureNew`)}</p>
            <p>{t(`${copy}.futureExisting`)}</p>
          </div>
        </div>
      </section>
    </PublicPage>
  );
}
