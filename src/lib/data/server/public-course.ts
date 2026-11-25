import { createClient, isAuthSessionMissingError } from "@supabase/supabase-js";
import { cache } from "react";

import {
  INTERNAL_COURSE_ID_PREFIX,
  INTERNAL_COURSE_TITLE_PREFIX,
  isInternalSmokeCourse,
} from "@/domain/teacher-course";
import { hasPermission, isRole, type Role } from "@/lib/permissions";
import { assertSupabaseClientConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server-only (the `/server/` segment is this repo's marker, as in
// src/lib/payments/server and src/lib/learn/server).
//
// WHY THIS MODULE EXISTS
//
// src/lib/data/published-courses.ts starts with "use client", so nothing in it
// can be imported from a Server Component — neither the row mapper nor
// `courseUrlSlug`. That was why the course page could not resolve a
// creator's course on the server and fell back to the literal metadata "Course", the same for
// everyone: pasting the link of any course into WhatsApp produced the same card, with no
// title, no description and no image.
//
// The anonymous read works here and does not need service_role: the policy
// `courses_select_public` allows `status IN ('published','in_review')` for
// `{public}`, and the EXECUTE of the predicates was given back to anon in
// 20260901120000 — before that every anonymous read aborted with 42501, which is
// exactly why this approach was not possible until today.

/** Only what the public page and the share card need. */
export type PublicCourseSummary = {
  id: string;
  urlSlug: string;
  title: string;
  summary: string | null;
  category: string | null;
  coverImageUrl: string | null;
  lessonCount: number | null;
  /** "course", "community", "ebook" or "live_event": only a course talks about lessons. */
  productFormat: string | null;
  updatedAt: string | null;
};

const PUBLIC_FIELDS =
  "id, title, title_key, slug, summary, category, cover_image_url, lesson_count, product_format, status, updated_at";

type CourseRow = {
  id: string;
  title: string | null;
  title_key: string | null;
  slug: string | null;
  summary: string | null;
  category: string | null;
  cover_image_url: string | null;
  lesson_count: number | null;
  product_format?: string | null;
  status: string | null;
  updated_at: string | null;
};

/**
 * A course's public URL is the `title_key`, falling back to `id` on old
 * rows — mirrors `courseUrlSlug` from published-courses.ts. Duplicated on
 * purpose: importing from there would drag the "use client" into the server.
 */
function publicUrlSlug(row: CourseRow): string {
  return row.title_key || row.slug || row.id;
}

function toSummary(row: CourseRow): PublicCourseSummary {
  return {
    id: row.id,
    urlSlug: publicUrlSlug(row),
    title: row.title ?? "Course",
    summary: row.summary,
    category: row.category,
    coverImageUrl: row.cover_image_url,
    lessonCount: row.lesson_count,
    productFormat: row.product_format ?? null,
    updatedAt: row.updated_at,
  };
}

/**
 * Resolves a published course by id OR title_key, in the same order the client
 * uses (published-courses.ts:209-228) — if the two ends diverge, the metadata
 * describes one course and the body shows another.
 *
 * Only `published`: the policy also allows `in_review`, but a course in review
 * is not for sale and must not get a public page or enter the sitemap.
 *
 * React `cache`: generateMetadata and the page read the same ref in the same
 * request. Without it the database answered twice, and the two reads could
 * diverge (the link card described one thing and the body showed another).
 */
export const getPublicCourseByRef = cache(async (
  ref: string,
): Promise<PublicCourseSummary | null> => {
  try {
    const supabase = await createSupabaseServerClient();

    const byId = await supabase
      .from("courses")
      .select(PUBLIC_FIELDS)
      .eq("id", ref)
      .eq("status", "published")
      .maybeSingle();

    if (byId.data) return toSummary(byId.data as CourseRow);

    const byKey = await supabase
      .from("courses")
      .select(PUBLIC_FIELDS)
      .eq("title_key", ref)
      .eq("status", "published")
      .limit(1);

    const row = byKey.data?.[0];
    return row ? toSummary(row as CourseRow) : null;
  } catch {
    // The page has a fallback path (the client component keeps fetching),
    // so a read failure here degrades the metadata — it never takes the route down.
    return null;
  }
});

export type CourseRefAccess = "visible" | "missing" | "unknown";

const ACCESS_FIELDS = "id, status, owner_id";

type AccessRow = { id: string; status: string | null; owner_id: string | null };

/**
 * What the /courses/[ref] page does with a ref that is not in the static catalog
 * and is not a published course found.
 *
 * The read uses the client of the request's SESSION, so RLS decides what exists
 * for the requester: the owner (courses_select_owner), the aal2 admin
 * (courses_select_admin) and the enrolled learner (courses_select_enrolled) read
 * drafts and archived courses; the public only reads published and in review
 * (courses_select_public). Since "in review" is readable by anyone, there
 * being the owner or the admin is required.
 *
 * - "visible": renders (preview for the owner/admin, or a published course).
 * - "missing": a real 404.
 * - "unknown": the read failed; the caller must NOT answer 404 — a
 *   database hiccup cannot take down the page of a published course.
 *
 * React `cache` for the same reason as getPublicCourseByRef: metadata and
 * page decide sample/404 with ONE answer per request.
 */
export const getCourseRefAccess = cache(async (ref: string): Promise<CourseRefAccess> => {
  try {
    const supabase = await createSupabaseServerClient();

    // courses.id is TEXT: a title_key does not make this lookup fail, it just finds
    // nothing. An error here is a real failure — and continuing to the title_key, empty in the
    // links that carry the raw id (Stripe's cancel_url, "see public page",
    // teacher profile), would give a 404 on a course that is live.
    const byId = await supabase
      .from("courses")
      .select(ACCESS_FIELDS)
      .eq("id", ref)
      .maybeSingle();
    if (byId.error) return "unknown";
    let row = (byId.data as AccessRow | null) ?? null;

    if (!row) {
      const byKey = await supabase
        .from("courses")
        .select(ACCESS_FIELDS)
        .eq("title_key", ref)
        .limit(1);
      if (byKey.error) return "unknown";
      row = (byKey.data?.[0] as AccessRow | undefined) ?? null;
    }

    if (!row) {
      // Revoked session (suspended and restored account, accepted invite): GoTrue
      // still accepts the JWT, but the restrictive policy account_access_guard hides
      // EVERY row of it, a published course included. Not finding it there is not "it does not
      // exist". With no session in the cookie, getUser answers without going to the network.
      const { error: userError } = await supabase.auth.getUser();
      return userError?.code === "account_access_denied" ? "unknown" : "missing";
    }
    if (row.status === "published") return "visible";
    // courses_select_public only exposes published and in_review. A draft,
    // needs_changes or inactive course that came back is RLS authorizing THIS reader
    // (owner, aal2 admin or enrolled learner) — it does not depend on getUser, which
    // can fail with the JWT still valid.
    if (row.status !== "in_review") return "visible";

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (!user) {
      // No session, or a session owing the second factor: anonymous visitor.
      // Any other Auth failure is not an answer and does not become a 404.
      const anonymous = !userError
        || isAuthSessionMissingError(userError)
        || userError.code === "mfa_required";
      return anonymous ? "missing" : "unknown";
    }
    if (row.owner_id === user.id) return "visible";

    // Same test as the client (creator-course-detail: hasPermission(roles,
    // "platform.accessAdmin")), with the roles of the session profile. An
    // operational role only counts in an aal2 session (20260912010000).
    const profile = await supabase.from("users").select("roles").eq("uid", user.id).maybeSingle();
    if (profile.error) return "unknown";
    const roles = Array.isArray(profile.data?.roles)
      ? profile.data.roles.filter((role): role is Role => typeof role === "string" && isRole(role))
      : [];
    if (!hasPermission({ roles }, "platform.accessAdmin")) return "missing";
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) return "unknown";
    return assurance.data.currentLevel === "aal2" ? "visible" : "missing";
  } catch {
    return "unknown";
  }
});

/**
 * ANONYMOUS client for public reads on the server: no cookie (a visitor's
 * expired token does not become a 401), a single attempt and a short deadline.
 *
 * No retry because postgrest-js repeats GET 3 times (1 s, 2 s, 4 s)
 * and only gives up right away on AbortError — the deadline blows up with TimeoutError,
 * so a silent database held each route ~13 s. The response stays `revalidate`
 * seconds in Next's data cache.
 */
export function anonymousReadClient({ timeoutMs, revalidate }: { timeoutMs: number; revalidate: number }) {
  const { url, anonKey } = assertSupabaseClientConfig();
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { retry: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs), next: { revalidate } }),
    },
  });
}

/**
 * Is there at least ONE real published course? Decides the home's course strip and
 * the sitemap's /courses.
 *
 * - Anonymous client, no cookie: a visitor's expired token does not become a 401
 *   and does not make their section disappear. `courses_select_public` allows published.
 * - Internal test courses are filtered out in the SQL, by the same prefixes as the
 *   store predicate, and one row is enough.
 * - The response stays 5 min in Next's data cache and the read gives up at
 *   1.5 s: the home does not wait for the database on every visit.
 * - No retry: postgrest-js repeats GET 3 times (1 s, 2 s, 4 s) and only
 *   gives up right away on AbortError — the deadline blows up with TimeoutError, so
 *   a silent database held each route ~13 s.
 * - React `cache`: layout, page and footer ask in the same request and the
 *   database answers once (fetch with `signal` is not deduplicated by Next).
 * - A failure counts as "no" (the section disappears, the page does not break) and goes to the log.
 */
export const hasRealPublishedCourse = cache(async (): Promise<boolean> => {
  try {
    const { data, error } = await anonymousReadClient({ timeoutMs: 1_500, revalidate: 300 })
      .from("courses")
      .select("id")
      .eq("status", "published")
      .not("id", "like", `${INTERNAL_COURSE_ID_PREFIX}%`)
      .not("title", "like", `${INTERNAL_COURSE_TITLE_PREFIX}%`)
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  } catch (error) {
    console.error("[public-course] hasRealPublishedCourse failed", error);
    return false;
  }
});

// Open storefront (the owner's decision, Nov 13, 2026): the "The marketplace" section of the
// home and the doors to the store (menu, footer, shortcuts) only show up with a
// real storefront. Below that, they disappear by themselves; /courses stays up.
export const MARKETPLACE_MIN_COURSES = 12;
export const MARKETPLACE_MIN_TEACHERS = 5;

export function marketplaceIsOpen(ownerIds: ReadonlyArray<string | null>): boolean {
  return ownerIds.length >= MARKETPLACE_MIN_COURSES && new Set(ownerIds).size >= MARKETPLACE_MIN_TEACHERS;
}

/**
 * Does the store have enough real published courses to become a storefront? Same
 * anonymous, cached read as hasRealPublishedCourse; a failure counts as
 * closed — the home never breaks because of it.
 */
export const isMarketplaceOpen = cache(async (): Promise<boolean> => {
  try {
    const { data, error } = await anonymousReadClient({ timeoutMs: 1_500, revalidate: 300 })
      .from("courses")
      .select("owner_id")
      .eq("status", "published")
      .not("id", "like", `${INTERNAL_COURSE_ID_PREFIX}%`)
      .not("title", "like", `${INTERNAL_COURSE_TITLE_PREFIX}%`)
      .limit(1000);
    if (error) throw error;
    return marketplaceIsOpen((data ?? []).map((row) => row.owner_id));
  } catch (error) {
    console.error("[public-course] isMarketplaceOpen failed", error);
    return false;
  }
});

/**
 * Title and cover of ONE published course, for the "See a real course" card on the
 * home while the storefront is closed. Same read as isMarketplaceOpen:
 * anonymous client, a single attempt, really gives up at 1.5 s (the fetch is
 * aborted) and the response stays 5 min in Next's data cache. That way the home
 * does not pay a trip to the database per visit, and a slow database does not hold each
 * visit nor leave abandoned reads retrying behind the scenes. Only the two
 * columns the card uses. A failure or a blown deadline counts as null: the home shows
 * the text card.
 */
export const getShowcaseCourseCover = cache(async (
  id: string,
): Promise<{ title: string; coverImageUrl: string | null } | null> => {
  try {
    const { data, error } = await anonymousReadClient({ timeoutMs: 1_500, revalidate: 300 })
      .from("courses")
      .select("title, cover_image_url")
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle();
    if (error) throw error;
    return data ? { title: data.title, coverImageUrl: data.cover_image_url } : null;
  } catch (error) {
    console.error("[public-course] getShowcaseCourseCover failed", error);
    return null;
  }
});

/**
 * Real published courses, one per sitemap URL. Internal test courses are filtered out
 * by the SAME predicate the store uses; their page stays up.
 */
export async function listPublishedCourses(): Promise<PublicCourseSummary[]> {
  try {
    const supabase = await createSupabaseServerClient();

    const { data } = await supabase
      .from("courses")
      .select(PUBLIC_FIELDS)
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(1000);

    return (data ?? [])
      .map((row) => toSummary(row as CourseRow))
      .filter((course) => !isInternalSmokeCourse(course));
  } catch {
    return [];
  }
}
