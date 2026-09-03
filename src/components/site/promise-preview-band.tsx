import Link from "next/link";
import { ScrollText, BadgeCheck } from "lucide-react";

import { BrandName } from "@/components/shared/brand-name";
import { RevealSection } from "@/components/shared/reveal-section";
import { getServerTranslation } from "@/lib/i18n/server";

// Server component: só texto traduzido, nenhum estado. Sai do bundle do
// navegador; o que precisa do cliente aqui é o RevealSection, que continua
// cliente e é montado como filho.
export async function PromisePreviewBand() {
  const { t } = await getServerTranslation();

  // All six commitments, in order — listed as the clauses of the public charter.
  // Mirrors the canonical list on /promise so the visual stays truthful. The
  // charter is the whole story here: the three "01/03/04" cards that used to
  // sit under it repeated clauses out of sequence and made people count.
  const charter: ReadonlyArray<{ n: string; label: string }> = [
    { n: "01", label: t("home.promise.clause1") },
    { n: "02", label: t("home.promise.clause2") },
    { n: "03", label: t("home.promise.clause3") },
    { n: "04", label: t("home.promise.clause4") },
    { n: "05", label: t("home.promise.clause5") },
    { n: "06", label: t("home.promise.clause6") },
  ];

  return (
    <section className="bg-[var(--color-surface-soft)] px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      <div className="mx-auto w-full max-w-7xl">
        <RevealSection>
          <div className="grid items-center gap-8 lg:grid-cols-[1fr_0.8fr]">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                {t("home.promise.kicker")}
              </p>
              <h2 className="display-title mt-3 text-4xl leading-tight text-[var(--color-primary)] sm:text-5xl">
                {t("home.promise.title")}
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">
                {t("home.promise.sub")}
              </p>
              <Link
                href="/promise"
                className="button-outline mt-6 px-4 py-2.5 text-sm"
              >
                {t("home.promise.readFull")}
              </Link>
            </div>
            {/* The promise rendered as what it actually is: a public, written
                charter. Six numbered clauses, a "public record" header, and a
                ratified signature line — so the visual communicates "written
                down, public" instead of standing as abstract decoration. Tokens
                only (no hardcoded white) so it adapts to dark mode. Tighter
                padding under lg keeps it on the phone too. */}
            <div className="relative overflow-hidden rounded-[18px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1 bg-[var(--color-accent)]"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-12 -top-12 size-44 rounded-full opacity-70"
                style={{
                  background:
                    "radial-gradient(circle, var(--color-line) 0%, transparent 70%)",
                }}
              />
              <div className="relative p-5 sm:p-7">
                <div className="flex items-center justify-between">
                  <span
                    className="grid size-10 place-items-center rounded-[10px] bg-[var(--color-surface-soft)] text-[var(--color-accent-fg)]"
                    aria-hidden="true"
                  >
                    <ScrollText size={20} strokeWidth={1.7} />
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--color-ink-muted)]">
                    {t("home.promise.cardBadge")}
                  </span>
                </div>

                <h3 className="mt-5 text-xl font-semibold leading-tight text-[var(--color-primary)] sm:text-2xl">
                  {t("home.promise.cardTitle")}
                </h3>
                <p className="mt-1 text-[13px] leading-6 text-[var(--color-ink-soft)]">
                  {t("home.promise.cardSub")}
                </p>

                <div className="my-5 h-px bg-[var(--color-line)]" />

                <ul className="grid gap-2.5">
                  {charter.map((clause) => (
                    <li key={clause.n} className="flex items-baseline gap-3">
                      <span className="font-mono text-[11px] font-bold tabular-nums text-[var(--color-accent-fg)]">
                        {clause.n}
                      </span>
                      <span className="text-[13px] font-medium leading-5 text-[var(--color-ink)]">
                        {clause.label}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="my-5 h-px bg-[var(--color-line)]" />

                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-muted)]">
                      {t("home.promise.ratified")}
                    </p>
                    <p className="mt-1 text-lg font-semibold leading-none text-[var(--color-primary)]">
                      <BrandName />
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
                    <BadgeCheck
                      size={13}
                      strokeWidth={2}
                      className="text-[var(--color-accent-fg)]"
                      aria-hidden="true"
                    />
                    {t("home.promise.sealed")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </RevealSection>
      </div>
    </section>
  );
}
