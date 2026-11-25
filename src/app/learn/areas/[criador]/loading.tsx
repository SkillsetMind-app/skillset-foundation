import { ProtectedSurface } from "@/components/auth/protected-surface";
import { MemberAreaHomeSkeleton } from "@/components/learn/member-area-home";
import { getServerTranslation } from "@/lib/i18n/server";

/**
 * The members area routes (/learn/areas/<criador>, /<area> and the two
 * communities) fetch the creator's brand on the server before responding.
 * Without this file, a click left the previous screen frozen until the
 * response arrived.
 *
 * No area shell on purpose, as in the classroom loading: the shell draws the
 * brand, and the brand is only known after the fetch. The skeleton is the
 * area's own (the same one it shows while reading), in the same box: the shell
 * <main> classes and the margin the area puts around it. That way the wait is
 * a single one, with no change of shape. With the guard, the first load shows
 * the same spinner the page would show.
 */
export default async function LoadingMemberArea() {
  const { t } = await getServerTranslation();
  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      <div className="mx-auto w-full max-w-[1280px] py-6 md:px-6 lg:px-8">
        <div className="px-4 md:px-0">
          <MemberAreaHomeSkeleton label={t("learn.memberArea.loading")} />
        </div>
      </div>
    </ProtectedSurface>
  );
}
