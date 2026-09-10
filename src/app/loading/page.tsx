import { LoadingScreen } from "@/components/auth/loading-screen";
import type { Metadata } from "next";
import { Suspense } from "react";
import { getServerTranslation } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return {
    title: t("appErrors.preparingMetadataTitle"),
    robots: { index: false, follow: false },
  };
}

export default function LoadingPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LoadingScreen />
    </Suspense>
  );
}

async function LoadingFallback() {
  const { t } = await getServerTranslation();
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-base)] px-5">
      <section className="text-center">
        <div className="mx-auto mb-5 size-14 rounded-full border-[3px] border-[rgba(26,54,93,0.12)] border-t-[var(--color-accent-fg)] motion-safe:animate-spin" />
        <p className="text-sm font-semibold text-[var(--color-ink-soft)]">
          {t("appErrors.preparingAccess")}
        </p>
      </section>
    </main>
  );
}
