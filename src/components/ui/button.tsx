import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { BusyLabel } from "@/components/ui/busy-label";
import { cn } from "@/lib/cn";

/**
 * Roles: navy (`solid`) acts; brass (`accent`) only at the two milestones of the journey,
 * "Create product" and "Publish product". Never brass on error, warning or delete
 * (that is `danger`).
 */
export type ButtonVariant = "solid" | "outline" | "danger" | "ghost" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * The global classes (.button-solid and company, globals.css:1006+) define
 * FOUR things: border, background, color and shadow. They do not define radius, spacing,
 * font weight or icon alignment. That is why each of their 361 uses
 * repeated by hand "inline-flex items-center gap-2 rounded-[10px] px-4 py-2
 * text-sm font-semibold". That remainder is what lives here.
 */
const variantClass: Record<ButtonVariant, string> = {
  solid: "button-solid",
  outline: "button-outline",
  danger: "button-danger",
  accent: "button-accent",
  // No global class: transparent background that only gains color on hover. The only
  // variant that brings its own transition (the others come from the global CSS).
  ghost:
    "border border-transparent bg-transparent text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "min-h-11 px-4 py-2.5 text-sm",
  // 48px and 15px/600 come from .button-lg (components layer).
  lg: "button-lg",
};

// No `transition` here: the utility (150ms) beat the components layer and
// fought with the global CSS's 120ms press / 180ms release. The 60% for
// disabled applies to ghost; the other variants already get it from the
// central rule in globals.css.
const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The text form, for whoever needs a <Link> dressed as a button — 40 files
 * do this. A polymorphic component to serve next/link would cost more
 * typing than it is worth: the call site already writes <Link>, only the outfit is missing.
 */
export function buttonClasses(
  options: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean } = {},
  className?: string,
) {
  const { variant = "solid", size = "md", fullWidth = false } = options;
  return cn(base, variantClass[variant], sizeClass[size], fullWidth && "w-full", className);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Icon to the left of the text. Decorative: the button's name is the text. */
  icon?: ReactNode;
  /** Loading: the spinner takes the icon's place and the button locks. */
  loading?: boolean;
  /**
   * Waiting label ("Saving..."), written beside the spinner while
   * `loading`. With it, both labels (and the spinner's spot) are
   * reserved in the same cell: the button always has the same width.
   */
  busyLabel?: ReactNode;
};

export function Button({
  variant = "solid",
  size = "md",
  fullWidth = false,
  icon,
  loading = false,
  busyLabel,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const spinner = (
    <Loader2 aria-hidden="true" size={16} strokeWidth={2.2} className="shrink-0 motion-safe:animate-spin" />
  );
  return (
    <button
      // Without an explicit type, every button inside a <form> submits the form.
      type={type}
      className={buttonClasses({ variant, size, fullWidth }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {busyLabel === undefined ? (
        <>
          {loading ? spinner : icon}
          {children}
        </>
      ) : (
        // The spinner lives on the waiting face: invisible at rest, but already
        // taking up its place, so appearing does not widen the button.
        <BusyLabel
          busy={loading}
          idle={
            <>
              {icon}
              {children}
            </>
          }
          busyText={
            <>
              {spinner}
              {busyLabel}
            </>
          }
        />
      )}
    </button>
  );
}
