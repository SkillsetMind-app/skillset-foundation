import { PenLine, Send, Sparkles, type LucideIcon } from "lucide-react";

import { RevealSection } from "@/components/shared/reveal-section";
import { payoutClearDays } from "@/data/plans";

type Step = {
  number: string;
  title: string;
  description: string;
  Icon: LucideIcon;
};

const steps: ReadonlyArray<Step> = [
  {
    number: "01",
    title: "Set up your studio",
    description:
      "Open a Teacher Studio account, accept Teacher Terms, connect Stripe Express. Free, takes minutes.",
    Icon: PenLine,
  },
  {
    number: "02",
    title: "Build and submit",
    description:
      "Build modules and lessons in Course Builder. Set pricing and a free preview lesson. Submit for review.",
    Icon: Sparkles,
  },
  {
    number: "03",
    title: "Sell globally",
    description: `Your course goes live on the marketplace as soon as you submit — Skillset review runs alongside, so nothing holds up your first sale. Get paid in 30+ currencies, with earnings clearing ${payoutClearDays} days after each sale.`,
    Icon: Send,
  },
];

export function HowItWorksStrip() {
  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      <RevealSection className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          How it works
        </p>
        <h2 className="display-title mt-3 text-4xl leading-tight text-[var(--color-primary)] sm:text-5xl">
          Three steps from idea to income.
        </h2>
      </RevealSection>
      <div className="mt-10 grid gap-8 sm:mt-12 lg:grid-cols-3">
        {steps.map((step, index) => {
          const { Icon } = step;
          return (
            <RevealSection key={step.number} delay={index * 120}>
              <article className="border-t-2 border-[var(--color-primary)] pt-6">
                <div className="flex items-center gap-4">
                  <span
                    className="grid size-11 place-items-center rounded-[10px] bg-[var(--color-primary)] text-white shadow-[0_10px_22px_rgba(26,54,93,0.18)]"
                    aria-hidden="true"
                  >
                    <Icon size={20} strokeWidth={1.7} />
                  </span>
                  <p
                    className="display-title text-6xl leading-none text-[var(--color-ink-muted)]"
                    aria-hidden="true"
                  >
                    {step.number}
                  </p>
                </div>
                <h3 className="mt-5 text-lg font-bold text-[var(--color-primary)]">
                  {step.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                  {step.description}
                </p>
              </article>
            </RevealSection>
          );
        })}
      </div>
    </section>
  );
}
