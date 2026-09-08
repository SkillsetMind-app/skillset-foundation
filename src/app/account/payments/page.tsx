import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { TeacherWalletPanel } from "@/components/teacher/teacher-wallet-panel";

export default function AccountPaymentsPage() {
  return (
    <ProtectedSurface permissions={["teacherStudio.access"]}>
      {/* Sem `description`: as quatro frases que ficavam aqui empurravam o
          primeiro numero para baixo de tres paragrafos. O texto vive agora no
          "Learn more" recolhido do painel, em EN/ES. */}
      <PlatformShell title="Payouts & tax" compact>
        <TeacherWalletPanel />
      </PlatformShell>
    </ProtectedSurface>
  );
}
