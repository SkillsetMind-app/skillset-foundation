import Link from "next/link";

type EmptyStateProps = {
  eyebrow: string;
  title: string;
  description: string;
  cta?: {
    href: string;
    label: string;
  };
};

export function EmptyState({
  eyebrow,
  title,
  description,
  cta,
}: EmptyStateProps) {
  return (
    <div className="rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-brand)]">
        {eyebrow}
      </p>
      <h3 className="display-title text-3xl text-[var(--color-ink)]">{title}</h3>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
        {description}
      </p>
      {cta ? (
        <Link
          href={cta.href}
          className="button-solid mt-6 px-4 py-2.5 text-sm"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
