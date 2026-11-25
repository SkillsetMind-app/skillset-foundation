import type { ReactNode } from "react";
import Link from "next/link";

import { PublicPage } from "@/components/site/public-page";

// The long documents (/legal/*, /refund-policy) use the SAME frame as the
// other public pages: PublicPage, in reading mode. They used to be a separate
// mold — card inside card, both with a shadow, and an h1 in fixed text-6xl
// that was not the .page-title of the rest of the site. The text and the date arrive
// translated by the server pages, keeping this frame synchronous.

type LegalArticleProps = {
  kicker: string;
  title: string;
  intro: ReactNode;
  effectiveDate: string;
  effectiveLabel: string;
  children: ReactNode;
};

export function LegalArticle({
  kicker,
  title,
  intro,
  effectiveDate,
  effectiveLabel,
  children,
}: LegalArticleProps) {
  return (
    <PublicPage
      reading
      eyebrow={kicker}
      title={title}
      description={
        <>
          {intro}
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
            {effectiveLabel.replace("{date}", () => effectiveDate)}
          </p>
        </>
      }
    >
      {/* 16px with a 28px line height, same as the PublicPage introduction right
          above: 14px with 32px split the lines into loose fragments. */}
      <div className="mt-10 space-y-10 border-t border-[var(--color-line)] pt-10 text-base leading-7 text-[var(--color-ink-soft)]">
        {children}
      </div>
    </PublicPage>
  );
}

// Translations can name inline tags, never supply link destinations or HTML attributes.
const legalLinks = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
  teacherTerms: "/legal/teacher-terms",
  copyright: "/legal/copyright",
  promise: "/promise",
  pricing: "/pricing",
  account: "/account",
  support: "mailto:support@skillsetmind.com",
  legal: "mailto:legal@skillsetmind.com",
} as const;

export function LegalText({ text }: { text: string }) {
  const parts = text.split(/(<(?:strong|em|terms|privacy|teacherTerms|copyright|promise|pricing|account|support|legal)>[^<>]*<\/(?:strong|em|terms|privacy|teacherTerms|copyright|promise|pricing|account|support|legal)>)/g);
  return parts.map((part, index) => {
    const match = /^<(strong|em|terms|privacy|teacherTerms|copyright|promise|pricing|account|support|legal)>([^<>]*)<\/\1>$/.exec(part);
    if (!match) return part;
    const [, tag, content] = match;
    if (tag === "strong") {
      return <strong key={index} className="text-[var(--color-ink)]">{content}</strong>;
    }
    if (tag === "em") return <em key={index}>{content}</em>;
    const href = legalLinks[tag as keyof typeof legalLinks];
    // No color of its own: the link follows the paragraph color, which is how the public
    // site was approved. The brass that used to be here never reached the screen.
    return href.startsWith("mailto:") ? (
      <a key={index} className="font-semibold" href={href}>
        {href.slice("mailto:".length)}
      </a>
    ) : (
      <Link key={index} className="font-semibold" href={href}>
        {content}
      </Link>
    );
  });
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold text-[var(--color-primary)]">
        {heading}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

// Visible placeholder for facts the founder still needs to confirm (entity
// name, jurisdiction, addresses). Rendering them loudly beats shipping a
// document that silently invents them.
export function Define({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-[var(--color-warning-soft)] px-1 py-0.5 font-semibold text-[var(--color-warning-fg)]">
      [{children}]
    </mark>
  );
}
