import type { ReactNode } from "react";

import { PublicPage } from "@/components/site/public-page";

// Os documentos longos (/legal/*, /refund-policy) usam a MESMA moldura das
// outras páginas públicas: o PublicPage, em modo leitura. Antes eram um molde
// à parte — cartão dentro de cartão, os dois com sombra, e um h1 em text-6xl
// fixo que não era o .page-title do resto do site. Os arquivos de página não
// mudam: continuam passando kicker/title/intro/effectiveDate.

type LegalArticleProps = {
  kicker: string;
  title: string;
  intro: ReactNode;
  effectiveDate: string;
  children: ReactNode;
};

export function LegalArticle({
  kicker,
  title,
  intro,
  effectiveDate,
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
            Effective {effectiveDate}
          </p>
        </>
      }
    >
      <div className="mt-10 space-y-10 border-t border-[var(--color-line)] pt-10 text-sm leading-8 text-[var(--color-ink-soft)]">
        {children}
      </div>
    </PublicPage>
  );
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
