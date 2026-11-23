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
      {/* O h1 é o nome da pessoa (I-03), que só chega no navegador: a ficha
          desenha o próprio cabeçalho, com "Person record" em cima. */}
      <PlatformShell
        title={t("platform.ops.userDossier.pageTitle")}
        compact
        hideHeader
        currentNavigationHref={getOpsNavItem("users").href}
      >
        {/* UID é UUID: sem "%" próprio, então decodificar é seguro com ou sem decodificação prévia do Next. */}
        <OpsUserDossierPanel uid={decodeURIComponent(uid)} />
      </PlatformShell>
    </ProtectedSurface>
  );
}
