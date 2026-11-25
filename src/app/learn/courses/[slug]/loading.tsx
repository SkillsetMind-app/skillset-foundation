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
    // Side margin equal to the shell's (md:px-6 lg:px-8); on the phone the
    // breathing room comes from ClassroomLoading itself, as inside the shell.
    <div className="mx-auto w-full max-w-[1280px] py-6 md:px-6 lg:px-8">
      {/* This file does not read the address (loading.tsx does not receive
          the params), so it does not know whether the lesson opens on the
          cover or on the short header. It keeps the short one, the shape that
          jumps the least: it is the most common path ("Continue" on the
          dashboard, with ?lesson=), where the wait keeps ONE shape until the
          header arrives; on the first visit the cover grows once downward,
          instead of a ~400px block shrinking to 52px on every resumed
          lesson. */}
      <ClassroomLoading label={t("learnWave2.courseLoading.title")} short />
    </div>
  );
}
