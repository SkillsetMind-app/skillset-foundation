import { PlatformInviteAcceptance } from "@/components/auth/platform-invite-acceptance";

export default async function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlatformInviteAcceptance id={id} />;
}
