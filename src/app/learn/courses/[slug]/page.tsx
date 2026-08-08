import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { CreatorCourseWorkspace } from "@/components/learn/creator-course-workspace";
import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { MemberAreaBrand } from "@/components/learn/member-area-shell";
import { MemberAreaShell } from "@/components/learn/member-area-shell";
import type { StorefrontConfig } from "@/domain/user-profile";
import { getCourseBySlug, getCourseSlugs } from "@/lib/data/catalog";
import { CourseViewedTracker } from "@/lib/posthog/page-trackers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export function generateStaticParams() {
  return getCourseSlugs().map((slug) => ({ slug }));
}

// Whitelabel (pro and up): the teacher's mark replaces ours in the classroom.
// Resolved here, on the server, because the route only knows the course id and
// the swap has to be in the first paint — a client-side lookup would show the
// SkillsetMind logo and then blink it away, which is worse than not selling
// the feature at all.
//
// `courses` and `public_profiles` are both readable with the caller's own
// session: published courses are public, and the projection table is
// anon-readable by design. Nothing here needs service_role.
async function getMemberAreaBrand(courseId: string): Promise<MemberAreaBrand | null> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: course } = await supabase
      .from("courses")
      .select("owner_id")
      .eq("id", courseId)
      .maybeSingle();

    if (!course?.owner_id) {
      return null;
    }

    const { data: profile } = await supabase
      .from("public_profiles")
      .select("display_name, storefront")
      .eq("uid", course.owner_id)
      .maybeSingle();

    const storefront = profile?.storefront as StorefrontConfig | null;

    // The DB decides. Absent flag = plan does not include it = our mark stays.
    if (storefront?.branding?.hidePlatformBrand !== true) {
      return null;
    }

    return {
      name: profile?.display_name?.trim() || "Instructor",
      logoUrl: storefront.branding.logoUrl ?? null,
    };
  } catch {
    // A branding lookup must never keep a paying student out of their class.
    return null;
  }
}

export default async function LearnCoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = getCourseBySlug(slug);

  if (!course) {
    const brand = await getMemberAreaBrand(slug);

    return (
      <ProtectedSurface permissions={["courses.viewLearning"]}>
        {/* Same member area as the catalog branch below. getCourseBySlug only
            matches the static demo catalog, so every teacher-published course
            lands here — this is the live path (Stripe success_url, "Continue"
            on the dashboard), not a fallback. It has to open in the member
            shell too, or the dashboard rail comes back for real students. */}
        <MemberAreaShell brand={brand}>
          <Suspense
            fallback={
              <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
                <p className="text-sm text-[var(--color-ink-soft)]">
                  Loading creator course...
                </p>
              </section>
            }
          >
            <CreatorCourseWorkspace initialCourseId={slug} />
          </Suspense>
        </MemberAreaShell>
      </ProtectedSurface>
    );
  }

  return (
    <ProtectedSurface permissions={["courses.viewLearning"]}>
      {/* COURSE_VIEWED — fired on mount of the enrolled course route.
          source="direct" because we can't infer marketing source here;
          referrer-based source resolution happens in PostHog itself via
          $referrer/$referring_domain on the same session. */}
      <CourseViewedTracker
        course_id={course.id}
        slug={course.slug}
        source="direct"
      />
      <MemberAreaShell>
        <EnrolledCourseWorkspace course={course} />
      </MemberAreaShell>
    </ProtectedSurface>
  );
}
