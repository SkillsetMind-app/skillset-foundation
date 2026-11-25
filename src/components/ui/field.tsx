import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The worst hole in the inventory: 138 labels in the project, and the link between
 * field, hint and error message exists in TWO places (2 aria-describedby,
 * 2 aria-invalid). Someone using a screen reader fills in the form, gets a
 * field wrong, and learns neither which field nor why.
 *
 * Here that is not optional: children receives the accessibility props
 * ready to spread on the control, so the author does not have to remember.
 *
 * The `id` comes from outside instead of useId() on purpose — useId is a hook, a hook
 * forces "use client", and most callers already have an id because of
 * htmlFor. A server component is cheaper than the convenience.
 */
export type FieldA11y = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
  required: boolean;
};

export type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (a11y: FieldA11y) => ReactNode;
};

export function Field({
  id,
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  // Both together and in this order: the screen reader announces the hint before the
  // error, which is the order in which the person needs them.
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("grid grid-cols-1 gap-2", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-[var(--color-ink)]">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-[var(--color-danger-fg)]">
            *
          </span>
        ) : null}
      </label>

      {hint ? (
        <p id={hintId} className="text-xs leading-5 text-[var(--color-ink-soft)]">
          {hint}
        </p>
      ) : null}

      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
        required,
      })}

      {error ? (
        // role="alert" because the error appears AFTER submit: without it, the
        // message enters the page silently.
        <p
          id={errorId}
          role="alert"
          className="text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
