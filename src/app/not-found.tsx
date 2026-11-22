import Link from "next/link";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { getServerTranslation } from "@/lib/i18n/server";

// Componente de servidor para poder montar o rodapé (que é servidor) junto com
// a barra: antes o 404 era um cartão solto, sem menu e sem rodapé, e o único
// caminho era "Go home". O layout raiz já lê o idioma do cookie, então isto
// não muda como a página é gerada.
export default async function NotFound() {
  const { t } = await getServerTranslation();
  return (
    <div className="page-shell">
      <SiteNav />
      <main id="conteudo" className="flex min-h-[60svh] items-center justify-center px-6 py-16">
        <div className="surface-card max-w-2xl rounded-lg p-8 text-center sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-accent-fg)]">
            {t("publicPages.notFound.eyebrow")}
          </p>
          <h1 className="display-title page-title mt-4 text-[var(--color-ink)]">
            {t("publicPages.notFound.title")}
          </h1>
          <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("publicPages.notFound.body")}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="button-solid px-4 py-2.5 text-sm"
            >
              {t("publicPages.notFound.home")}
            </Link>
            {/* Havia um segundo botão para /courses (antes, /platform). Com a
                loja ainda vazia ele levava a um catálogo sem curso; a home é o
                único caminho até haver o que mostrar. */}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
