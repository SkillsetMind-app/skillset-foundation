type SkillsetSpinnerProps = {
  title?: string;
  description?: string;
  /** When true, fills the viewport (centered). Otherwise inline-centered. */
  fullscreen?: boolean;
};

/**
 * The single canonical SkillsetMind loading visual: an animated circular
 * spinner with a calm title/description. Used everywhere a loading
 * state is shown so the experience is consistent (no second style).
 */
export function SkillsetSpinner({
  title = "Preparing your workspace",
  description = "One moment. SkillsetMind is getting things ready.",
  fullscreen = true,
}: SkillsetSpinnerProps) {
  const Title = fullscreen ? "h1" : "p";
  const content = (
    <section className="text-center">
      <div className="mx-auto mb-5 size-14 rounded-full border-[3px] border-[rgba(26,54,93,0.12)] border-t-[var(--color-accent-fg)] motion-safe:animate-spin" />
      <Title className="display-title text-[22px] font-semibold text-[var(--color-primary)]">
        {title}
      </Title>
      <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
        {description}
      </p>
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
