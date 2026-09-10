import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { CreatorSubscriptionCenter } from "@/components/teacher/creator-subscription-center";
import { StripeConnectNotice } from "@/components/teacher/stripe-connect-notice";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("platform.nav.subscriptions");
}

export default async function TeacherSubscriptionsPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      <PlatformShell
        eyebrow={t("teach.page.eyebrow")}
        title={t("platform.nav.subscriptions")}
        description={t("teach.subscriptionsPage.description")}
      >
        <StripeConnectNotice />
        <CreatorSubscriptionCenter />
      </PlatformShell>
    </ProtectedSurface>
  );
}
