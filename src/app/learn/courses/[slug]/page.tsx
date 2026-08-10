import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import { CreatorCourseWorkspace } from "@/components/learn/creator-course-workspace";
import { EnrolledCourseWorkspace } from "@/components/learn/enrolled-course-workspace";
import type { MemberAreaBrand } from "@/components/learn/member-area-shell";
import { MemberAreaShell } from "@/components/learn/member-area-shell";
import type { MembersTheme } from "@/domain/teacher-course";
import { normalizeMembersTheme } from "@/domain/teacher-course";
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
//
// The same round trip also carries members_theme, so the shell and the
// classroom card can never disagree about light/dark.
async function getMemberArea(courseId: string): Promise<{
  brand: MemberAreaBrand | null;
  theme: MembersTheme;
}> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: course } = await supabase
      .from("courses")
      .select("owner_id, members_theme")
      .eq("id", courseId)
      .maybeSingle();

    const theme = normalizeMembersTheme(course?.members_theme) ?? "light";

    if (!course?.owner_id) {
      return { brand: null, theme };
    }

    const { data: profile } = await supabase
      .from("public_profiles")
      .select("display_name, storefront")
      .eq("uid", course.owner_id)
      .maybeSingle();

    const storefront = profile?.storefront as StorefrontConfig | null;

    // The DB decides. Absent flag = plan does not include it = our mark stays.
    if (storefront?.branding?.hidePlatformBrand !== true) {
      return { brand: null, theme };
    }

    return {
      brand: {
        name: profile?.display_name?.trim() || "Instructor",
        logoUrl: storefront.branding.logoUrl ?? null,
        accentColor: storefront.branding.accentColor ?? null,
      },
      theme,
    };
  } catch {
    // A branding lookup must never keep a paying student out of their class.
    return { brand: null, theme: "light" };
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
    const { brand, theme } = await getMemberArea(slug);

    return (
      <ProtectedSurface permissions={["courses.viewLearning"]}>
        {/* Same member area as the catalog branch below. getCourseBySlug only
            matches the static demo catalog, so every teacher-published course
            lands here — this is the live path (Stripe success_url, "Continue"
            on the dashboard), not a fallback. It has to open in the member
            shell too, or the dashboard rail comes back for real students. */}
        <MemberAreaShell brand={brand} theme={theme}>
          <Suspense
            fallback={
              // Members tokens, not platform ones: this fallback paints inside
              // the themed shell, and a white card on the dark bg reads as a
              // flash of the wrong product.
              <section className="rounded-[14px] border border-[var(--ma-line)] bg-[var(--ma-surface)] p-6">
                <p className="text-sm text-[var(--ma-ink-soft)]">
                  Loading creator course...
                </p>
              </section>
            }
          >
            <CreatorCourseWorkspace
              initialCourseId={slug}
              whitelabel={Boolean(brand)}
            />
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
      {/* Static demo catalog: the course record is already in hand, so the
          theme comes straight off it — no round trip, and shell and classroom
          card read the same value. */}
      <MemberAreaShell theme={course.membersTheme ?? "light"}>
        <EnrolledCourseWorkspace course={course} />
      </MemberAreaShell>
    </ProtectedSurface>
  );
}
