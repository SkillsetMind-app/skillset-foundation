"use client";

import Link from "next/link";
import {
  Lock,
  Download,
  LogOut,
  ScrollText,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { RevealSection } from "@/components/shared/reveal-section";

type Promise = {
  eyebrow: string;
  title: string;
  description: string;
  Icon: LucideIcon;
};

export function PromisePreviewBand() {
  const { t } = useTranslation();

  const promises: ReadonlyArray<Promise> = [
    {
      eyebrow: "01",
      title: t("home.promise.p1Title"),
      description: t("home.promise.p1Desc"),
      Icon: Lock,
    },
    {
      eyebrow: "03",
      title: t("home.promise.p2Title"),
      description: t("home.promise.p2Desc"),
      Icon: Download,
    },
    {
      eyebrow: "04",
      title: t("home.promise.p3Title"),
      description: t("home.promise.p3Desc"),
      Icon: LogOut,
    },
  ];

  // All six commitments, in order — listed as the clauses of the public charter.
  // Mirrors the canonical list on /promise so the visual stays truthful.
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
            </div>
            {/* The promise rendered as what it actually is: a public, written
                charter. Six numbered clauses, a "public record" header, and a
                ratified signature line — so the visual communicates "written
                down, public" instead of standing as abstract decoration. Tokens
                only (no hardcoded white) so it adapts to dark mode.
                Desktop-only to keep the mobile band lean. */}
            <div className="relative hidden overflow-hidden rounded-[18px] border border-[var(--color-line-strong)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)] lg:block">
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
              <div className="relative p-7">
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

                <h3 className="display-title mt-5 text-2xl leading-tight text-[var(--color-primary)]">
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

                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-muted)]">
                      {t("home.promise.ratified")}
                    </p>
                    <p className="display-title mt-1 text-xl italic leading-none text-[var(--color-primary)]">
                      Skillset
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

        <div className="mt-10 grid gap-5 sm:mt-12 md:grid-cols-3">
          {promises.map((promise, index) => {
            const { Icon } = promise;
            return (
              <RevealSection key={promise.title} delay={index * 100}>
                <article className="group h-full rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] transition duration-[180ms] ease-out hover:-translate-y-0.5 hover:border-[rgba(26,54,93,0.18)] hover:shadow-[0_18px_36px_rgba(15,39,68,0.10)]">
                  <div className="flex items-center justify-between">
                    <span
                      className="grid size-11 place-items-center rounded-[10px] bg-[var(--color-surface-soft)] text-[var(--color-primary)] transition-colors group-hover:bg-[var(--color-primary)] group-hover:text-[var(--color-base)]"
                      aria-hidden="true"
                    >
                      <Icon size={20} strokeWidth={1.7} />
                    </span>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                      {promise.eyebrow}
                    </p>
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-[var(--color-primary)]">
                    {promise.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                    {promise.description}
                  </p>
                </article>
              </RevealSection>
            );
          })}
        </div>

        <RevealSection delay={260}>
          <Link href="/promise" className="button-outline mt-10 px-4 py-2.5 text-sm">
            {t("home.promise.readFull")}
          </Link>
        </RevealSection>
      </div>
    </section>
  );
}
