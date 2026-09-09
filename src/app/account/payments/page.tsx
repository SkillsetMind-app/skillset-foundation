import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";
import { getServerTranslation } from "@/lib/i18n/server";

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
          producao, 08/09). O titulo fica so para o rotulo da regiao. */}
      <PlatformShell title={t("account.payoutsTax")} compact hideHeader>
        <TeacherWalletPanel />
      </PlatformShell>
    </ProtectedSurface>
  );
}
