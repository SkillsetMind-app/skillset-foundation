import type { ReactNode } from "react";

import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * The platform's page header, the only one. There used to be five systems on
 * sibling screens (48px serif in Sales, 36px sans-serif on Home, 30px inside a
 * card in Media, 20px on the phone...). Now: an optional label (only when it names
 * a group), a 30px serif h1 at any width, one sentence, and the page actions
 * on the right, on the same bottom line. The screens that build their
 * own header (the title depends on what loaded) use this same
 * component with `hideHeader` on the shell.
 *
 * Only in the studio (/teach): the learner's classroom, the account, support and the internal
 * panel keep the shell's old header. That is why the classes are
 * utilities and not `.platform-page-heading`, which is their rule.
 */
export function PlatformPageHeader({
  eyebrow,
  title,
  description,
  actions,
  titleAside,
  children,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Next to the h1, outside it (the help "?"): inside, the screen reader read the
   *  button name as part of the page title. */
  titleAside?: ReactNode;
  /** Below the sentence, in the same column (a collapsed "Learn more"). */
  children?: ReactNode;
  compact?: boolean;
}) {
  const heading = (
    <h1
      className={`display-title ${
        eyebrow && !titleAside ? "mt-2" : ""
      } max-w-4xl text-3xl leading-tight text-[var(--color-primary)]`}
    >
      {title}
    </h1>
  );
  return (
    <div
      className={`flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-5 ${
        compact ? "pt-1" : "pt-2"
      }`}
    >
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        {titleAside ? (
          <div className={`flex items-center gap-2 ${eyebrow ? "mt-2" : ""}`}>
            {heading}
            {titleAside}
          </div>
        ) : heading}
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
