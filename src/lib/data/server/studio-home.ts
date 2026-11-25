import { unstable_rethrow } from "next/navigation";

import type { PlanId } from "@/data/plans";
import { isPlatformFlagOn } from "@/domain/platform-settings";
import { getServerAccount, isDocumentRequest } from "@/lib/auth/server-session";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type CourseRow = Database["public"]["Tables"]["courses"]["Row"];

const MAX_SEEDED_COURSE_BYTES = 64_000;

/**
 * What usePublishGates reads in the browser, already answered. A null field is
 * a read that failed here: the hook then reads that one itself, as before.
 */
export type PublishGatesSeed = {
  payoutsReady: boolean;
  verificationStatus: string;
  stripeConnectCountry: string | null;
  planId: PlanId;
  requireVerification: boolean | null;
  activationBlocked: boolean | null;
  planRequired: boolean | null;
};

/**
 * The studio home's products and publish gates, read on the server for one
 * page load: whose they are, and an id for that read, so the home draws them
 * once and never again when the same page comes back from the router's cache.
 */
export type StudioSeed = {
  id: string;
  uid: string;
  courseRows: CourseRow[];
  gates: PublishGatesSeed;
};

/**
 * The creator's products and publish gates, read on the server so /teach
 * leaves it with "Next steps" and "My products" already on the page.
 *
 * The home used to render without them and read five things in the browser
 * after hydration. "Next steps" appeared when the last one answered and pushed
 * "My products" down the page: a layout shift of 0.45 on a first visit.
 *
 * Same queries as the browser's (subscribeToTeacherCourses, usePublishGates),
 * with the creator's own session, so the same row-level rules apply. Only for
 * a full page load: inside the app the route opens at once and the browser
 * reads, as before.
 *
 * Null means "let the browser read it": not a page load, not a creator, or
 * the products could not be read. The home then behaves exactly as before.
 */
export async function getServerStudioSeed(): Promise<StudioSeed | null> {
  if (!(await isDocumentRequest())) {
    return null;
  }
  const account = await getServerAccount();
  if (!account || !account.user.roles.includes("teacher")) {
    return null;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const uid = account.user.uid;
    const [courses, flag, blocked, plan] = await Promise.all([
      supabase.from("courses").select("*").eq("owner_id", uid),
      supabase.from("platform_settings").select("value").eq("key", "require_creator_verification").maybeSingle(),
      supabase.rpc("creator_activation_blocked"),
      supabase.rpc("creator_plan_required"),
    ]);
    if (courses.error || !courses.data) {
      return null;
    }
    // A course row carries its whole outline, lesson text included, and these
    // rows travel inside the HTML, which is what the first paint waits for.
    // ponytail: whole rows up to a ceiling (today a creator's rows add up to
    // 16 kB at most); past it the browser reads, as before. A slim projection
    // for the home is the upgrade when creators outgrow this.
    if (JSON.stringify(courses.data).length > MAX_SEEDED_COURSE_BYTES) {
      return null;
    }

    const { profile } = account;
    return {
      id: crypto.randomUUID(),
      uid,
      courseRows: courses.data,
      gates: {
        // The same four values the hook takes from the profile row.
        payoutsReady: Boolean(profile.stripeConnectChargesEnabled && profile.stripeConnectPayoutsEnabled),
        verificationStatus: profile.creatorVerificationStatus ?? "none",
        stripeConnectCountry: profile.stripeConnectCountry ?? null,
        planId: profile.currentPlanId ?? "free",
        requireVerification: flag.error ? null : isPlatformFlagOn(flag.data?.value),
        // Both return a plain boolean; anything else is "unknown", never "no".
        activationBlocked: !blocked.error && typeof blocked.data === "boolean" ? blocked.data : null,
        planRequired: !plan.error && typeof plan.data === "boolean" ? plan.data : null,
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
