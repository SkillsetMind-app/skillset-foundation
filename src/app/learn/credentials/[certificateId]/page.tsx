import { ProtectedSurface } from "@/components/auth/protected-surface";
import { CertificatePrintView } from "@/components/certificates/certificate-print-view";
import { getServerTranslation } from "@/lib/i18n/server";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("learnWave2.print.metadataTitle"),
    description: t("learnWave2.print.metadataDescription"),
    path: "/learn/credentials",
  });
}

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ certificateId: string }>;
}) {
  const { certificateId } = await params;

  return (
    <ProtectedSurface permissions={["certificates.view"]}>
      <CertificatePrintView certificateId={certificateId} />
    </ProtectedSurface>
  );
}
