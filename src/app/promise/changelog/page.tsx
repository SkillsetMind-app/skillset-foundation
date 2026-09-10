import { PublicPage } from "@/components/site/public-page";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

const copy = "promiseChangelog";
const changedOn = "2026-07-24";

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
  const effectiveAt = dateFormat.format(new Date(`${changedOn}T00:00:00Z`));
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

        <div className="mt-8 rounded-[14px] border border-[var(--color-line)] bg-white p-5">
          <p className="text-sm font-bold text-[var(--color-ink)]">
            {changedOn} — {t(`${copy}.changeTitle`)}
          </p>
          <div className="mt-4 grid gap-2 text-sm leading-7 text-[var(--color-ink-soft)]">
            <p>
              {t(`${copy}.whatChanged`)}
            </p>
            <p>
              {t(`${copy}.why`)}
            </p>
            <p>{t(`${copy}.effectiveNew`).replace("{date}", () => effectiveAt)}</p>
            <p>
              {t(`${copy}.effectiveExisting`).replace("{date}", () => effectiveAt)}
            </p>
          </div>
        </div>

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
