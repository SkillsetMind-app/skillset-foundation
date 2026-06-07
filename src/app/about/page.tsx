import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "About",
  description:
    "Skillset is an international platform for serious online courses, built around reviewed quality, creator income, and verifiable learning.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-8 sm:py-16">
        <section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            About
          </p>
          <h1 className="display-title mt-4 text-6xl leading-none text-[var(--color-primary)]">
            Skillset is a public home for learning, teaching, and trusted growth.
          </h1>
          </div>
          <p className="mt-6 text-sm leading-8 text-[var(--color-ink-soft)]">
            Skillset brings professional programs, educator visibility, and a
            cleaner international learning experience together in one place.
          </p>
        </section>
        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          {["Professional programs", "Visible educators", "International learning network"].map((item) => (
            <div key={item} className="rounded-[14px] border border-[var(--color-line)] bg-white p-5">
              <p className="text-sm font-semibold text-[var(--color-primary)]">{item}</p>
            </div>
          ))}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
