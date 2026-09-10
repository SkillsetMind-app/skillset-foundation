import { PlansPanel } from "@/components/account/plans-panel";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { refundWindowDays } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("accountPlansPage.title");
}

export default async function AccountPlansPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      {/* O cartão de abertura ("Pricing model / Choose the plan that fits…")
          era a segunda manchete da página, antes de "Current plan" virar a
          terceira. A página abre no que importa: o plano atual e os cartões.
          A frase de que todo plano inclui tudo foi para a descrição do título. */}
      <PlatformShell
        title={t("accountPlansPage.title")}
        description={t("accountPlansPage.description")}
        compact
      >
        <section className="grid gap-5">
          <PlansPanel />

          <div className="grid gap-4 lg:grid-cols-3">
            <PolicyCard
              title={t("accountPlansPage.processing")}
              detail={t("accountPlansPage.processingBody")}
            />
            <PolicyCard
              title={t("accountPlansPage.refund")}
              detail={t("accountPlansPage.refundBody").replace("{days}", () => String(refundWindowDays))}
            />
            <PolicyCard
              title={t("accountPlansPage.payouts")}
              detail={t("accountPlansPage.payoutsBody")}
            />
          </div>
        </section>
      </PlatformShell>
    </ProtectedSurface>
  );
}

function PolicyCard({ detail, title }: { detail: string; title: string }) {
  return (
    <article className="rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
        {title}
      </p>
      <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
    </article>
  );
}
