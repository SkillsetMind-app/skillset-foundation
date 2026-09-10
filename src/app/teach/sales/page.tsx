import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { SaleList } from "@/components/teacher/sale-list";
import { StripeConnectNotice } from "@/components/teacher/stripe-connect-notice";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("teach.salesPage.title");
}

export default async function TeacherSalesPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow={t("teach.salesPage.eyebrow")}
        title={t("teach.salesPage.title")}
        description={t("teach.salesPage.description")}
      >
        <StripeConnectNotice />
        <SaleList />
      </PlatformShell>
    </ProtectedSurface>
  );
}
