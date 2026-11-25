import { OpsUserDossierPanel } from "@/components/admin/ops-user-dossier";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getOpsNavItem } from "@/data/site";
import { getServerTranslation } from "@/lib/i18n/server";

export default async function OpsUserDossierPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const { t } = await getServerTranslation();

  return (
    // The screen asks for users.manage (admin only); the real decision is made by the RPC, with admin and aal2.
    <ProtectedSurface permissions={["users.manage"]}>
      {/* The h1 is the person's name (I-03), which only reaches the browser: the
          record draws its own header, with "Person record" on top. */}
      <PlatformShell
        title={t("platform.ops.userDossier.pageTitle")}
        compact
        hideHeader
        currentNavigationHref={getOpsNavItem("users").href}
      >
        {/* A UID is a UUID: it has no "%" of its own, so decoding is safe with or without Next's prior decoding. */}
        <OpsUserDossierPanel uid={decodeURIComponent(uid)} />
      </PlatformShell>
    </ProtectedSurface>
  );
}
