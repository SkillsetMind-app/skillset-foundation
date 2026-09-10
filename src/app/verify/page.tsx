import { Suspense } from "react";

import { CertificateVerificationPanel } from "@/components/certificates/certificate-verification-panel";
import { SiteNav } from "@/components/site/site-nav";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function VerifyPage() {
  const { t } = await getServerTranslation();
  return (
    <main className="min-h-screen bg-[var(--color-surface)]">
      <div className="print:hidden">
        <SiteNav />
      </div>
      <div className="px-5 py-12 md:px-8 md:py-16">
        <Suspense
          fallback={
            <section className="mx-auto max-w-4xl rounded-[20px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
              <p className="text-sm text-[var(--color-ink-soft)]">
                {t("learnWave2.verification.pageLoading")}
              </p>
            </section>
          }
        >
          <CertificateVerificationPanel />
        </Suspense>
      </div>
    </main>
  );
}
