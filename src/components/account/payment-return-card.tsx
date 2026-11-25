import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

// The screens after payment (plan return, visit without a checkout reference,
// checkout, activation fee return) each had its own design: one
// centered with a gray icon and an outline button, another with "THANKS" and
// a second serif. Now the same card, in the same order: round icon,
// main sentence, explanation and actions, the main one first and the only filled one.
// No server and no state here: the sentences and what confirms (or not) the
// payment stay with each screen.
export function PaymentReturnCard({
  icon,
  heading,
  body,
  actions,
  headingLevel = 2,
}: {
  icon: ReactNode;
  heading: string;
  body: string;
  actions: ReactNode;
  /** Outside the platform shell (no page title), the sentence is the h1. */
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <Card padding="lg">
      {/* A single live region, the same in all states: the screen reader reads
          the main sentence and, when it changes, the result. */}
      <div role="status" aria-live="polite">
        <span className="grid size-10 place-items-center rounded-full bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
          {icon}
        </span>
        <Heading className="mt-3 text-lg font-bold leading-[26px] text-[var(--color-ink)]">{heading}</Heading>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-ink-soft)]">{body}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">{actions}</div>
    </Card>
  );
}
