import {
  Award,
  Calendar,
  Globe,
  LayoutGrid,
  MessagesSquare,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { RevealSection } from "@/components/shared/reveal-section";
import { payoutClearDays } from "@/data/plans";

type Capability = {
  title: string;
  description: string;
  Icon: LucideIcon;
};

const capabilities: ReadonlyArray<Capability> = [
  {
    title: "Course builder",
    description:
      "Modular structure, multiple lesson types, scheduled events, a free preview slot.",
    Icon: LayoutGrid,
  },
  {
    title: "Drip-released content",
    description:
      "Release lessons by progress or on a schedule, and protect your work during the refund window.",
    Icon: Calendar,
  },
  {
    title: "Private program community",
    description:
      "Every paid course gets a private space for posts, replies, and likes. Members keep talking there after the lesson ends.",
    Icon: MessagesSquare,
  },
  {
    title: "Multi-currency checkout",
    description:
      "Sell in 30+ currencies. Learners pay in their own currency at checkout.",
    Icon: Globe,
  },
  {
    title: `Creator wallet, ${payoutClearDays}-day clearance`,
    description: `Earnings move from pending to available ${payoutClearDays} days after each sale. Full ledger, full audit trail.`,
    Icon: Wallet,
  },
  {
    title: "Verifiable certificates",
    description:
      "A public link anyone can check in seconds. Proof your members did the work.",
    Icon: Award,
  },
];

export function CapabilitiesGrid() {
  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      <RevealSection className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Built into Skillset
        </p>
        <h2 className="display-title mt-3 text-4xl leading-tight text-[var(--color-primary)] sm:text-5xl">
          Everything your program needs is already built in.
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">
          No add-ons. No locked features. Every plan ships the same toolset.
          Your plan only changes the commission you pay per sale.
        </p>
      </RevealSection>
      <div className="mt-10 grid gap-5 sm:mt-12 md:grid-cols-2 xl:grid-cols-3">
        {capabilities.map((capability, index) => {
          const { Icon } = capability;
          return (
            <RevealSection key={capability.title} delay={index * 80}>
              <article className="group h-full rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] transition duration-[180ms] ease-out hover:-translate-y-0.5 hover:border-[var(--color-line-strong)] hover:shadow-[var(--shadow-strong)]">
                <span
                  className="grid size-12 place-items-center rounded-[10px] bg-[var(--color-surface-soft)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-line)] shadow-[0_6px_14px_rgba(26,54,93,0.08)] transition-all duration-[180ms] ease-out group-hover:bg-[var(--color-primary)] group-hover:text-[var(--color-base)] group-hover:shadow-[0_10px_22px_rgba(26,54,93,0.20)]"
                  aria-hidden="true"
                >
                  <Icon size={22} strokeWidth={1.7} />
                </span>
                <h3 className="mt-5 text-lg font-bold text-[var(--color-primary)]">
                  {capability.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                  {capability.description}
                </p>
              </article>
            </RevealSection>
          );
        })}
      </div>
    </section>
  );
}
