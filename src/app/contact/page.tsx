import Link from "next/link";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

const SUPPORT_EMAIL = "support@skillset.app";

export const metadata = buildPageMetadata({
  title: "Contact",
  description:
    "Reach the Skillset team for support, partnerships, or press.",
  path: "/contact",
});

const contactRoutes = [
  {
    label: "General inquiries",
    value:
      "Questions about programs, access, and the overall Skillset experience.",
    action: {
      label: "Email the team",
      href: `mailto:${SUPPORT_EMAIL}?subject=General%20inquiry`,
      external: true,
    },
  },
  {
    label: "Educator applications",
    value:
      "For professionals who want to teach, collaborate, or bring expertise to the platform.",
    action: {
      label: "Explore teaching on Skillset",
      href: "/for-creators",
      external: false,
    },
  },
  {
    label: "Support and safety",
    value:
      "A dedicated route for learner care, account help, and trust-related concerns.",
    action: {
      label: "Open a support ticket",
      href: "/support",
      external: false,
    },
  },
  {
    label: "Partnerships and press",
    value:
      "For institutions, regional collaborators, strategic growth, and media conversations.",
    action: {
      label: "Email partnerships",
      href: `mailto:${SUPPORT_EMAIL}?subject=Partnership%20or%20press`,
      external: true,
    },
  },
] as const;

export default function ContactPage() {
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-8 sm:py-16">
        <section className="max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            Contact
          </p>
          <h1 className="display-title mt-4 text-6xl leading-none text-[var(--color-primary)]">
            Reach the right team for support, teaching, and partnerships.
          </h1>
          <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            Prefer email? Write to{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-semibold text-[var(--color-primary)] hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>{" "}
            and we&rsquo;ll route it to the right team. Account holders can also
            open a tracked ticket from inside the platform.
          </p>
        </section>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {contactRoutes.map((route) => (
            <div
              key={route.label}
              className="flex flex-col rounded-[14px] border fine-rule bg-white p-5 shadow-[var(--shadow-soft)]"
            >
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">
                {route.label}
              </p>
              <p className="mt-3 flex-1 text-sm leading-7 text-[var(--color-ink-soft)]">
                {route.value}
              </p>
              {route.action.external ? (
                <a
                  href={route.action.href}
                  className="mt-4 inline-flex text-sm font-semibold text-[var(--color-primary)] hover:underline"
                >
                  {route.action.label} &rarr;
                </a>
              ) : (
                <Link
                  href={route.action.href}
                  className="mt-4 inline-flex text-sm font-semibold text-[var(--color-primary)] hover:underline"
                >
                  {route.action.label} &rarr;
                </Link>
              )}
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
