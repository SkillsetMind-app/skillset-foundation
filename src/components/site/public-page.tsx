import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";

type PublicPageProps = {
  eyebrow: string;
  title: string;
  /** Texto corrido; aceita nós para páginas que precisam de um link no meio. */
  description: ReactNode;
  /**
   * Documento longo de leitura corrida (jurídico, política): a coluna encolhe
   * para ~72 caracteres e o cabeçalho empilha, porque a grade de duas colunas
   * só faz sentido quando há largura sobrando.
   */
  reading?: boolean;
  children: ReactNode;
};

export function PublicPage({
  eyebrow,
  title,
  description,
  reading = false,
  children,
}: PublicPageProps) {
  return (
    <div className="page-shell">
      <SiteNav />
      <main
        className={`mx-auto w-full px-6 py-12 sm:px-8 sm:py-16 ${
          reading ? "max-w-[72ch]" : "max-w-7xl"
        }`}
      >
        <section
          className={
            reading
              ? "grid gap-6"
              : "grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center"
          }
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {eyebrow}
            </p>
            {/* .page-title (globals.css): clamp em vez de text-6xl fixo — 60px
                não cabiam num celular de 360px. */}
            <h1 className="display-title page-title mt-4 text-[var(--color-primary)]">
              {title}
            </h1>
          </div>
          {/* <div> e não <p>: os documentos longos passam a introdução já em
              parágrafos, e <p> dentro de <p> é HTML inválido. */}
          <div className="text-sm leading-8 text-[var(--color-ink-soft)]">
            {description}
          </div>
        </section>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
