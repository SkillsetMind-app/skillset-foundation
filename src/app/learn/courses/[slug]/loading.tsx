import { ClassroomLoading } from "@/components/learn/classroom-loading";
import { getServerTranslation } from "@/lib/i18n/server";
/**
 * Stripe's success_url lands here, and the page awaits two Supabase queries
 * before it returns anything. Without this file Next keeps the *previous*
 * page painted for that whole round trip, so a buyer who just paid stares at
 * the checkout page and assumes the purchase failed.
 *
 * No MemberAreaShell here on purpose: the shell renders a wordmark, and the
 * whitelabel brand is only known after the queries resolve. Framing this in
 * the shell would show the SkillsetMind mark and then blink it away — the
 * exact flash the page's server-side brand lookup exists to prevent.
 *
 * The course theme is not known yet either, so this is the classroom's one
 * loading state in neutral platform colours (it used to be hard-coded dark,
 * while courses default to light). The same component paints every later wait
 * inside the shell, so the student sees one loading screen, not four.
 */
export default async function LoadingCourse() {
  const { t } = await getServerTranslation();
  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
      <ClassroomLoading label={t("learnWave2.courseLoading.title")} />
    </div>
  );
}
