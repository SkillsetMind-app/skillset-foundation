import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("platform.nav.earnings");
}

export default async function AccountPaymentsPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      {/* No `description`: the four sentences that used to be here pushed the
          first number below three paragraphs. The text now lives in the
          panel's collapsed "Learn more", in EN/ES.
          `hideHeader`: the panel already opens with the header of its sibling
          screens ("Your earnings, your payout setup"). The shell title repeated
          that, and in fixed English even with a Spanish session (visual QA in
          production, 09/08). The panel now carries the page's <h1>; the shell
          still requires `title`, so it comes from the dictionary. */}
      <PlatformShell title={t("platform.nav.earnings")} compact hideHeader>
        <TeacherWalletPanel />
      </PlatformShell>
    </ProtectedSurface>
  );
}
