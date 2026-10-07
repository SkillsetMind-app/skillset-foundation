import type { MemberAreaBrand } from "@/components/learn/member-area-shell";
import type { MembersTheme } from "@/domain/teacher-course";
import { normalizeMembersTheme } from "@/domain/teacher-course";
import type { StorefrontConfig } from "@/domain/user-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server-only (the `/server/` path segment is this repo's marker for that, same
// as src/lib/payments/server). Shared by the student route
// (/learn/courses/[slug]) and the teacher preview (/teach/builder/[id]/preview)
// so the two can never drift: a preview that differs from the student view is
// not a preview.
//
// Whitelabel (pro and up): the teacher's mark replaces ours in the classroom.
// Resolved on the server, because the route only knows the course id and the
// swap has to be in the first paint — a client-side lookup would show the
// SkillsetMind logo and then blink it away, which is worse than not selling the
// feature at all.
//
// `courses` and `public_profiles` are both readable with the caller's own
// session: published courses are public, and the projection table is
// anon-readable by design. Nothing here needs service_role.
//
// The same round trip also carries members_theme, so the shell and the
// classroom card can never disagree about light/dark — and community_enabled,
// so the Help menu in the shell knows where a lesson question goes (the
// course community, or a message to the teacher when it is off).
export async function getMemberArea(courseId: string): Promise<{
  brand: MemberAreaBrand | null;
  theme: MembersTheme;
  communityEnabled: boolean;
}> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data: course } = await supabase
      .from("courses")
      .select("owner_id, members_theme, community_enabled")
      .eq("id", courseId)
      .maybeSingle();

    const theme = normalizeMembersTheme(course?.members_theme) ?? "light";
    const communityEnabled = course?.community_enabled === true;

    if (!course?.owner_id) {
      return { brand: null, theme, communityEnabled };
    }

    const { data: profile } = await supabase
      .from("public_profiles")
      .select("display_name, storefront")
      .eq("uid", course.owner_id)
      .maybeSingle();

    const storefront = profile?.storefront as StorefrontConfig | null;

    // The DB decides. Absent flag = plan does not include it = our mark stays.
    if (storefront?.branding?.hidePlatformBrand !== true) {
      return { brand: null, theme, communityEnabled };
    }

    return {
      brand: {
        name: profile?.display_name?.trim() || "Instructor",
        logoUrl: storefront.branding.logoUrl ?? null,
        accentColor: storefront.branding.accentColor ?? null,
      },
      theme,
      communityEnabled,
    };
  } catch {
    // A branding lookup must never keep a paying student out of their class.
    return { brand: null, theme: "light", communityEnabled: false };
  }
}
