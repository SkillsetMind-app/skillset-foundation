import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-shell flex min-h-screen items-center justify-center px-6">
      <div className="surface-card max-w-2xl rounded-[18px] p-8 text-center sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-accent-fg)]">
          Not found
        </p>
        <h1 className="display-title mt-4 text-6xl text-[var(--color-ink)]">
          This page could not be found.
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          Use the links below to keep exploring Skillset.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="button-solid px-4 py-2.5 text-sm"
          >
            Go home
          </Link>
          <Link
            href="/platform"
            className="button-outline px-4 py-2.5 text-sm"
          >
            Open platform overview
          </Link>
        </div>
      </div>
    </main>
  );
}
