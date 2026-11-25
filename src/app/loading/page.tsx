import { LoadingScreen } from "@/components/auth/loading-screen";
import { SkillsetSpinner } from "@/components/shared/skillset-spinner";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSignedInLoadingDestination } from "@/lib/auth/routing";
import { getServerAccount } from "@/lib/auth/server-session";
import { getServerTranslation } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation();
  return {
    title: t("appErrors.preparingMetadataTitle"),
    robots: { index: false, follow: false },
  };
}

type LoadingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// This route sits between signing in and the first workspace page. It used to
// always paint a spinner and work out the destination in the browser (wait for
// the session, read the profile, a minimum 400 ms), so every login paid for an
// extra page. The server already knows who is signed in: it answers with the
// redirect and nothing is painted. The spinner below is only what is left when
// the server cannot tell (no session yet, second factor owed, an error), and
// it decides the way it always did.
export default async function LoadingPage({ searchParams }: LoadingPageProps) {
  const account = await getServerAccount();
  if (account) {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(await searchParams)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first !== undefined) query.set(name, first);
    }
    redirect(getSignedInLoadingDestination(account.profile, query));
  }

  return (
    <Suspense fallback={<LoadingFallback />}>
      <LoadingScreen />
    </Suspense>
  );
}

// Same screen and same phrase as the LoadingScreen that takes its place: the
// switch from server to client is not visible.
async function LoadingFallback() {
  const { t } = await getServerTranslation();
  return <SkillsetSpinner title={t("authFlow.loading.title")} />;
}
