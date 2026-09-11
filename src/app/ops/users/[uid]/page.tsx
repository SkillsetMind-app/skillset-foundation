import { OpsUserDossierPanel } from "@/components/admin/ops-user-dossier";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getOpsNavItem } from "@/data/site";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function OpsUserDossierPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const { t } = await getServerTranslation();

  return (
    // A tela pede users.manage (só admin); quem decide de verdade é a RPC, com admin e aal2.
    <ProtectedSurface permissions={["users.manage"]}>
      <PlatformShell
        eyebrow={t("platform.nav.operations")}
        title={t("platform.ops.userDossier.pageTitle")}
        compact
        currentNavigationHref={getOpsNavItem("users").href}
      >
        {/* UID é UUID: sem "%" próprio, então decodificar é seguro com ou sem decodificação prévia do Next. */}
        <OpsUserDossierPanel uid={decodeURIComponent(uid)} />
      </PlatformShell>
    </ProtectedSurface>
  );
}
