import { getServerTranslation } from "@/lib/i18n/server";
import { ProtectedSurface } from "@/components/auth/protected-surface";
import { LearnerWishlist } from "@/components/learn/learner-wishlist";
import { PlatformShell } from "@/components/platform/platform-shell";

export default async function LearnWishlistPage() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <PlatformShell
        eyebrow={t("learnWave2.wishlist.eyebrow")}
        title={t("learnWave2.wishlist.title")}
        description={t("learnWave2.wishlist.description")}
      >
        <LearnerWishlist />
      </PlatformShell>
    </ProtectedSurface>
  );
}
