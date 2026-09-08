import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { SaleDetail } from "@/components/teacher/sale-detail";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function TeacherSaleDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow={t("teach.page.eyebrow")}
        title={t("teach.saleDetailPage.title")}
        description={t("teach.saleDetailPage.description")}
      >
        <SaleDetail orderId={orderId} />
      </PlatformShell>
    </ProtectedSurface>
  );
}
