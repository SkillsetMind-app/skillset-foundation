/**
 * Inline text wordmark: "Skillset" inherits the surrounding text color,
 * "Mind" takes the brand gold. Mirrors the two-tone lockup used by the
 * logo assets and the auth e-mail header (SKILLSET white / MIND gold).
 *
 * Uses --color-accent-fg (not raw --color-brass) so the gold stays
 * WCAG-readable on light surfaces and swaps to the lighter gold in dark
 * mode automatically.
 *
 * Use only where the brand name renders as real text (headings, footer,
 * stamps). Metadata, aria-labels, alt text, and plain strings stay
 * "SkillsetMind".
 */
export function BrandName({ className }: { className?: string }) {
  return (
    <span className={className}>
      Skillset
      <span className="text-[var(--color-accent-fg)]">Mind</span>
    </span>
  );
}
