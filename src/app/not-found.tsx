import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-shell flex min-h-screen items-center justify-center px-6">
      <div className="surface-card max-w-2xl rounded-[18px] p-8 text-center sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-accent-fg)]">
          Not found
        </p>
        <h1 className="display-title page-title mt-4 text-[var(--color-ink)]">
          This page could not be found.
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          Use the links below to keep exploring SkillsetMind.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="button-solid px-4 py-2.5 text-sm"
          >
            Go home
          </Link>
          {/* Era "Open platform overview" → /platform, uma vitrine interna.
              Quem cai num 404 quer conteúdo: o catálogo. */}
          <Link
            href="/courses"
            className="button-outline px-4 py-2.5 text-sm"
          >
            Browse courses
          </Link>
        </div>
      </div>
    </main>
  );
}
