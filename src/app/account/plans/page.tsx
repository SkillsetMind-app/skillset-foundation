import { PlansForTeachersOnly } from "@/components/account/plans-for-teachers-only";
import { PlansPanel } from "@/components/account/plans-panel";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { refundWindowDays } from "@/data/plans";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("accountPlansPage.title");
}

export default async function AccountPlansPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["auth.signOut"]}>
      <PlansForTeachersOnly>
        {/* The opening card ("Pricing model / Choose the plan that fits…") was the
            page's second headline, before "Current plan" became the third. The
            page now opens on what matters: the current plan and the cards. The
            sentence saying every plan includes everything moved to the title's
            description. */}
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
      </PlansForTeachersOnly>
    </ProtectedSurface>
  );
}

function PolicyCard({ detail, title }: { detail: string; title: string }) {
  return (
    <article className="rounded-lg border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
        {title}
      </p>
      <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">
        {detail}
      </p>
    </article>
  );
}
