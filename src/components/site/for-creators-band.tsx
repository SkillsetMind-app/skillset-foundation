import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { RevealSection } from "@/components/shared/reveal-section";
import { planById } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";

const freePlan = planById("free");

// Server component: só texto traduzido, nenhum estado. Sai do bundle do
// navegador; o que precisa do cliente aqui é o RevealSection, que continua
// cliente e é montado como filho.
export async function ForCreatorsBand() {
  const { t } = await getServerTranslation();

  const trustBullets = [
    t("home.creators.bullet1").replace(
      "{keep}",
      String(100 - freePlan.commissionPercent),
    ),
    t("home.creators.bullet2"),
    t("home.creators.bullet3"),
    t("home.creators.bullet4"),
  ];

  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      <RevealSection>
        <div className="relative overflow-hidden rounded-[20px] bg-[var(--color-primary)] p-6 text-white shadow-[var(--shadow-strong)] sm:p-8 lg:p-10">
          <div className="absolute inset-0 bg-gradient-to-br from-[#07172a] via-[#102944] to-[#1a365d]" />
          <div className="relative z-10 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/75">
                {t("home.creators.eyebrow")}
              </p>
              <h2 className="display-title mt-3 text-4xl leading-tight text-white sm:text-5xl">
                {t("home.creators.title")}
              </h2>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/auth?mode=signup&path=teacher"
                  className="button-solid-light group inline-flex items-center gap-2 px-4 py-2.5 text-sm"
                >
                  {t("home.creators.ctaStart")}
                  <ArrowRight
                    aria-hidden="true"
                    size={16}
                    strokeWidth={2}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </Link>
                <Link
                  href="/promise"
                  className="inline-flex items-center px-2 py-3 text-sm font-semibold text-white/80 underline-offset-4 transition hover:text-white hover:underline"
                >
                  {t("home.creators.ctaPromise")}
                </Link>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {trustBullets.map((bullet) => (
                <RevealSection key={bullet}>
                  <div className="flex h-full items-start gap-3 rounded-[14px] border border-white/16 bg-white/10 p-4 text-sm leading-6 text-white/85">
                    <span
                      aria-hidden="true"
                      className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--color-accent)]/30 text-[var(--color-accent-soft)]"
                    >
                      <Check size={14} strokeWidth={2.4} />
                    </span>
                    <span>{bullet}</span>
                  </div>
                </RevealSection>
              ))}
            </div>
          </div>
        </div>
      </RevealSection>
    </section>
  );
}
