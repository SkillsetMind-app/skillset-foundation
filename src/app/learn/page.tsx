import { PlatformShell } from "@/components/platform/platform-shell";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { LearnDashboard } from "@/components/learn/learn-dashboard";
import { getServerEnrollmentSeed } from "@/lib/data/server/learner-enrollments";
import { getServerTranslation } from "@/lib/i18n/server";
import { privatePageMetadata } from "@/lib/seo/private-page-metadata";

export async function generateMetadata() {
  return privatePageMetadata("learn.page.title");
}

export default async function LearnPage() {
  // The enrollments come with the page: the dashboard's main content is in the
  // first HTML instead of arriving after a read from the browser.
  const [{ t }, seed] = await Promise.all([getServerTranslation(), getServerEnrollmentSeed()]);

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      {/* hideHeader: the dashboard emits the only greeting (and the only h1).
          The shell title only names the browser tab: "My courses", like the
          menu — no longer "Your learning, in one place." with the marketing
          badge "Student experience". */}
      <PlatformShell title={t("learn.page.title")} hideHeader>
        <LearnDashboard seed={seed} />
      </PlatformShell>
    </ProtectedSurface>
  );
}
