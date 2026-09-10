import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("account.payoutsTax");
}

export default async function AccountPaymentsPage() {
  const { t } = await getServerTranslation();

  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      {/* Sem `description`: as quatro frases que ficavam aqui empurravam o
          primeiro numero para baixo de tres paragrafos. O texto vive agora no
          "Learn more" recolhido do painel, em EN/ES.
          `hideHeader`: o painel ja abre com "PAYOUTS & TAX" + "Your earnings,
          your payout setup." — o titulo da casca repetia isso uma terceira vez,
          e em ingles fixo mesmo com a sessao em espanhol (QA visual em
          producao, 08/09). Quem carrega o <h1> da pagina agora e o painel; a
          casca ainda exige `title`, entao ele vem do dicionario. */}
      <PlatformShell title={t("account.payoutsTax")} compact hideHeader>
        <TeacherWalletPanel />
      </PlatformShell>
    </ProtectedSurface>
  );
}
