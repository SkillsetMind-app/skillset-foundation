import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("teach.marketing.coupons.title");
}

// Coupons live inside each course's management central now — this route stays
// as a signpost for old links.
export default async function TeacherCouponsPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell title={t("teach.marketing.coupons.title")} hideHeader>
        <section className="overflow-hidden rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("teach.page.eyebrow")}
          </p>
          <h3 className="display-title mt-4 max-w-3xl text-4xl leading-tight text-[var(--color-primary)]">
            {t("teacherRouteResidual.couponsTitle")}
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            {t("teacherRouteResidual.couponsDescription")}
          </p>
          <div className="mt-6">
            <Link href="/teach/builder" className="button-solid px-4 py-2.5 text-sm">
              {t("teacherRouteResidual.openCourses")}
              <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} />
            </Link>
          </div>
        </section>
      </PlatformShell>
    </ProtectedSurface>
  );
}
