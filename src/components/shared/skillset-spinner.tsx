import type { ReactNode } from "react";

type SkillsetSpinnerProps = {
  title: string;
  /** When true, fills the viewport (centered). Otherwise inline-centered. */
  fullscreen?: boolean;
  /** Sits below the notice (e.g. "Try again" of a long wait), outside the read region. */
  children?: ReactNode;
};

/**
 * The single canonical SkillsetMind loading visual: an animated circular
 * spinner with one short line. Used everywhere a loading state is shown so the
 * experience is consistent (no second style).
 *
 * From entering to the studio the person goes through up to five waiting screens in a row
 * (/loading, the router mount, /welcome, the interview, the protected area).
 * All use this component with the same sentence: without a 22px serif title
 * or a description that changes, the swap from one screen to the next does not show. The
 * `role="status"` makes the screen reader read the sentence, which none of them did.
 */
export function SkillsetSpinner({
  title,
  fullscreen = true,
  children,
}: SkillsetSpinnerProps) {
  const Title = fullscreen ? "h1" : "p";
  const content = (
    <section className="text-center">
      <div role="status">
        <SpinnerRing className="mx-auto mb-5" />
        <Title className="text-base font-semibold text-[var(--color-primary)]">
          {title}
        </Title>
      </div>
      {children}
    </section>
  );

  if (fullscreen) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--color-base)] px-5">
        {content}
      </main>
    );
  }

  return (
    <div className="grid min-h-[280px] place-items-center px-5">{content}</div>
  );
}

/**
 * The house ring, on its own, for whoever already has the sentence and only needs the signal
 * (e.g. the payment return card's icon). A ring-only drawing: before
 * there was a hand-made copy with another track.
 *
 * Track in `--color-line`: the fixed 12% navy disappeared in the dark theme. The brass
 * arc spins only without "reduce motion"; with it on the ring stays still and
 * in view.
 */
export function SpinnerRing({
  size = "lg",
  className = "",
}: {
  size?: "sm" | "lg";
  className?: string;
}) {
  const shape = size === "sm" ? "size-5 border-2" : "size-14 border-[3px]";
  return (
    <span
      aria-hidden="true"
      className={`block ${shape} rounded-full border-[var(--color-line)] border-t-[var(--color-accent-fg)] motion-safe:animate-spin ${className}`.trim()}
    />
  );
}
