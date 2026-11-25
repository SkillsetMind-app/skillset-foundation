import Link from "next/link";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { getServerTranslation } from "@/lib/i18n/server";

// A server component so it can mount the footer (which is a server component)
// along with the bar: before, the 404 was a loose card, with no menu and no
// footer, and the only way out was "Go home". The root layout already reads
// the language from the cookie, so this does not change how the page is
// generated.
export default async function NotFound() {
  const { t } = await getServerTranslation();
  return (
    <div className="page-shell">
      <SiteNav />
      <main id="conteudo" className="flex min-h-[60svh] items-center justify-center px-6 py-16">
        <div className="surface-card max-w-2xl rounded-lg p-8 text-center sm:p-10">
          {/* The same navy eyebrow as the error page (app/error.tsx): the two
              "something went wrong" screens with a single look. */}
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-primary)]">
            {t("publicPages.notFound.eyebrow")}
          </p>
          <h1 className="display-title page-title mt-4 text-[var(--color-ink)]">
            {t("publicPages.notFound.title")}
          </h1>
          <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("publicPages.notFound.body")}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="button-solid px-4 py-2.5 text-sm"
            >
              {t("publicPages.notFound.home")}
            </Link>
            {/* There was a second button to /courses (before, /platform). With
                the store still empty it led to a catalog with no course; the
                home is the only way until there is something to show. */}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
