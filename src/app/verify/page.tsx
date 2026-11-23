import { Suspense } from "react";

import { CertificateVerificationPanel } from "@/components/certificates/certificate-verification-panel";
import { SiteNav } from "@/components/site/site-nav";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

// Sem isto a aba herdava o título genérico do layout raiz ("Coaching…").
export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("learnWave2.verification.metaTitle"),
    description: t("learnWave2.verification.metaDescription"),
    path: "/verify",
  });
}

export default async function VerifyPage() {
  const { t } = await getServerTranslation();
  return (
    // A barra fica fora do <main>: o "Skip to content" pula para o conteúdo, não
    // para dentro da própria barra.
    <div className="min-h-screen bg-[var(--color-surface)]">
      <div className="print:hidden">
        <SiteNav />
      </div>
      <main id="conteudo" className="px-5 py-12 md:px-8 md:py-16">
        {/* O mesmo cartão do painel, com o olho, o título, a frase e a
            fileira do código em esqueleto: o painel nasce no lugar, sem pulo.
            A frase fica para o leitor de tela. */}
        <Suspense
          fallback={
            <section
              role="status"
              className="mx-auto max-w-4xl rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] md:p-8"
            >
              <span className="sr-only">{t("learnWave2.verification.pageLoading")}</span>
              <div aria-hidden="true" className="animate-pulse">
                <div className="h-3 w-40 rounded-md bg-[var(--color-surface-strong)]" />
                <div className="mt-4 h-10 w-3/4 rounded-md bg-[var(--color-surface-strong)] md:h-14" />
                <div className="mt-5 h-4 max-w-2xl rounded-md bg-[var(--color-surface-strong)]" />
                <div className="mt-8 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="h-11 rounded-md bg-[var(--color-surface-strong)]" />
                  <div className="h-11 w-28 rounded-md bg-[var(--color-surface-strong)]" />
                </div>
              </div>
            </section>
          }
        >
          <CertificateVerificationPanel />
        </Suspense>
      </main>
    </div>
  );
}
