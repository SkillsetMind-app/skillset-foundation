import {
  BadgeCheck,
  Compass,
  GraduationCap,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { PublicPage } from "@/components/site/public-page";

type Step = {
  title: string;
  detail: string;
  Icon: LucideIcon;
};

const steps: ReadonlyArray<Step> = [
  {
    title: "Discover",
    detail:
      "Learners browse the marketplace by category, preview lessons, and read creator profiles.",
    Icon: Compass,
  },
  {
    title: "Enroll",
    detail:
      "Multi-currency checkout. Access activates only after the payment confirms.",
    Icon: Wallet,
  },
  {
    title: "Learn",
    detail:
      "Students progress through lessons, files, live events, and the course-linked community.",
    Icon: GraduationCap,
  },
  {
    title: "Verify",
    detail:
      "Meet the course requirements and earn a SkillsetMind Verified certificate with a public verification link anyone can check.",
    Icon: BadgeCheck,
  },
];

export default function HowItWorksPage() {
  return (
    <PublicPage
      eyebrow="How it works"
      title="Course-first learning with community built in."
      description="SkillsetMind keeps the main loop simple: creators publish structured courses, students enroll, learning happens inside a protected workspace, and progress leads toward proof."
    >
      <section className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => {
          const { Icon } = step;
          return (
            <article
              key={step.title}
              className="group rounded-[16px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)] transition duration-[180ms] ease-out hover:-translate-y-0.5 hover:border-[rgba(26,54,93,0.18)] hover:shadow-[0_18px_36px_rgba(15,39,68,0.10)]"
            >
              <div className="flex items-center justify-between">
                <span
                  className="grid size-11 place-items-center rounded-[10px] bg-[var(--color-primary)] text-[var(--color-base)] shadow-[0_10px_22px_rgba(26,54,93,0.18)]"
                  aria-hidden="true"
                >
                  <Icon size={20} strokeWidth={1.7} />
                </span>
                <span
                  aria-hidden="true"
                  className="display-title text-3xl leading-none text-[var(--color-accent-soft)]"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h2 className="mt-5 text-lg font-bold text-[var(--color-ink)]">
                {step.title}
              </h2>
              <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
                {step.detail}
              </p>
            </article>
          );
        })}
      </section>
    </PublicPage>
  );
}
