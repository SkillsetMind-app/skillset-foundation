import { unstable_rethrow } from "next/navigation";

import { getServerAccount, isDocumentRequest } from "@/lib/auth/server-session";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type EnrollmentRow = Database["public"]["Tables"]["enrollments"]["Row"];

/**
 * Enrollment rows read on the server for one page load: whose they are, and an
 * id for that read, so the dashboard draws them once and never again when the
 * same page comes back from the router's cache.
 */
export type EnrollmentSeed = { id: string; uid: string; rows: EnrollmentRow[] };

/**
 * The signed-in learner's enrollments, read on the server so /learn leaves it
 * with the courses already on the page.
 *
 * The dashboard used to render a skeleton and read this in the browser after
 * hydration, so its main content (the first course cover, or the empty state)
 * was the last thing to appear. Same query as subscribeToUserEnrollments, with
 * the caller's own session, so the same row-level rules apply.
 *
 * Only for a full page load. Inside the app the browser already has the
 * session and reads this in one round trip; waiting for the server there would
 * hold the navigation back instead.
 *
 * Rows come back already in the order the page shows them. The browser maps
 * them without sorting again: sorting on both sides could disagree (the server
 * and the browser collate accents by different locales) and break hydration.
 *
 * Null means "let the browser read it", for any reason: not a page load,
 * nobody signed in, or the read failed. The dashboard then behaves exactly as
 * before.
 */
export async function getServerEnrollmentSeed(): Promise<EnrollmentSeed | null> {
  if (!(await isDocumentRequest())) {
    return null;
  }
  const account = await getServerAccount();
  if (!account) {
    return null;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("enrollments")
      .select("*")
      .eq("user_id", account.user.uid);
    if (error || !data) {
      return null;
    }

    return {
      id: crypto.randomUUID(),
      uid: account.user.uid,
      rows: [...data].sort((left, right) => left.course_title.localeCompare(right.course_title)),
    };
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
