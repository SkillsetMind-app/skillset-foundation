import { ProtectedSurface } from "@/components/auth/protected-surface";
import { CertificatePrintView } from "@/components/certificates/certificate-print-view";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Certificate",
  description: "View and print your SkillsetMind Verified certificate.",
  path: "/learn/credentials",
});

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
