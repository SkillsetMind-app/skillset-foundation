import { Suspense } from "react";

import { ProtectedSurface } from "@/components/auth/protected-surface";
import type { MemberAreaBrand } from "@/components/learn/member-area-shell";
import { MemberAreaShell } from "@/components/learn/member-area-shell";
import { CoursePreviewShell } from "@/components/teacher/course-preview-shell";
import type { MembersTheme } from "@/domain/teacher-course";
import { normalizeMembersTheme } from "@/domain/teacher-course";
import type { StorefrontConfig } from "@/domain/user-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type TeacherBuilderPreviewPageProps = {
  params: Promise<{
    courseId: string;
  }>;
};

// Same lookup the student route runs (see /learn/courses/[slug]), because a
// preview that differs from the student view is not a preview. Kept local
// rather than shared: a Next page may only export its route contract, so the
// student page cannot export this for reuse.
async function getPreviewMemberArea(courseId: string): Promise<{
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
    return { brand: null, theme: "light" };
  }
}

export default async function TeacherBuilderPreviewPage({
  params,
}: TeacherBuilderPreviewPageProps) {
  const { courseId } = await params;
  const { brand, theme } = await getPreviewMemberArea(courseId);

  return (
    <ProtectedSurface permissions={["teacherStudio.manageCourses"]}>
      {/* MemberAreaShell, not PlatformShell: the teacher has to see the exact
          surface a student gets — dark members theme, their own mark, no
          platform sidebar or page heading wrapped around it. */}
      <MemberAreaShell brand={brand} theme={theme}>
        <Suspense
          fallback={
            <section className="rounded-[14px] border border-[var(--ma-line)] bg-[var(--ma-surface)] p-6">
              <p className="text-sm text-[var(--ma-ink-soft)]">
                Loading course preview...
              </p>
            </section>
          }
        >
          <CoursePreviewShell courseId={courseId} whitelabel={Boolean(brand)} />
        </Suspense>
      </MemberAreaShell>
    </ProtectedSurface>
  );
}
