import Link from "next/link";

import { PublicPage } from "@/components/site/public-page";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

const SUPPORT_EMAIL = "support@skillsetmind.com";

export const metadata = buildPageMetadata({
  title: "Contact",
  description:
    "Reach the SkillsetMind team for support, partnerships, or press.",
  path: "/contact",
});

// Todo caminho daqui funciona sem login. /support é uma tela protegida: para
// um visitante, "Open a support ticket" virava um formulário de login sem
// aviso. O ticket continua existindo, mas anunciado como o que é (só para
// quem tem conta), no parágrafo de abertura.
const contactRoutes = [
  {
    label: "General inquiries",
    value:
      "Questions about programs, access, and the overall SkillsetMind experience.",
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
      label: "Explore teaching on SkillsetMind",
      href: "/for-creators",
      external: false,
    },
  },
  {
    label: "Support and safety",
    value:
      "A dedicated route for learner care, account help, and trust-related concerns.",
    action: {
      label: "Email support",
      href: `mailto:${SUPPORT_EMAIL}?subject=Support`,
      external: true,
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
    <PublicPage
      eyebrow="Contact"
      title="Reach the right team for support, teaching, and partnerships."
      description={
        <>
          Prefer email? Write to{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-semibold text-[var(--color-primary)] hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          and we&rsquo;ll route it to the right team. Have an account?{" "}
          <Link
            href="/support"
            className="font-semibold text-[var(--color-primary)] hover:underline"
          >
            Open a tracked ticket
          </Link>{" "}
          from inside the platform.
        </>
      }
    >
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
                className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-primary)] hover:underline"
              >
                {route.action.label} &rarr;
              </a>
            ) : (
              <Link
                href={route.action.href}
                className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--color-primary)] hover:underline"
              >
                {route.action.label} &rarr;
              </Link>
            )}
          </div>
        ))}
      </div>
    </PublicPage>
  );
}
