import { cache } from "react";

import {
  INTERNAL_COURSE_ID_PREFIX,
  INTERNAL_COURSE_TITLE_PREFIX,
} from "@/domain/teacher-course";
import { isReservedHandle, type PublicProfile } from "@/domain/user-profile";
import { anonymousReadClient } from "@/lib/data/server/public-course";
import { rowToPublicProfile } from "@/lib/supabase/user-mappers";

// Server-only (`/server/` segment). The teacher's public profile is built
// on the SERVER: before, it loaded in the browser, and Instagram's browser
// showed the skeleton, a title identical for every teacher and a generic
// preview. `public_profiles` and published courses are already readable by anonymous.

/** Same format as users_username_format (migration 20260910040000). */
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

// One attempt, 3 s and 60 s of cache: Instagram sends spikes to the same
// page, and a profile edit shows up within a minute.
const client = () => anonymousReadClient({ timeoutMs: 3_000, revalidate: 60 });

/**
 * `ref` is the uid (`/instructors/{uid}`) or `@usuario` (`/@usuario`, which
 * next.config rewrites to `/instructors/@usuario`). The `@` decides the column,
 * so a uid is never confused with an @ and vice versa.
 *
 * - null: does not exist (or the @ does not even have a valid format) → a real 404;
 * - throws: the read failed → the error page, never a 404 that would take an
 *   existing profile out of the index.
 *
 * React `cache`: metadata and page ask in the same request, the database
 * answers once.
 */
export const getPublicProfileByRef = cache(async (ref: string): Promise<PublicProfile | null> => {
  const handle = ref.startsWith("@") ? ref.slice(1).toLowerCase() : null;
  if (handle !== null && (!USERNAME.test(handle) || isReservedHandle(handle))) return null;

  const { data, error } = await client()
    .from("public_profiles")
    // select *: if the deploy arrives before the verified badge migration, the new
    // columns are just missing (no badge) instead of taking the page down. The whole
    // table is already public.
    .select("*")
    .eq(handle === null ? "uid" : "username", handle ?? ref)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToPublicProfile(data) : null;
});

/** Only what the profile's course row shows. */
export type CreatorCourse = {
  id: string;
  href: string;
  title: string;
  coverImageUrl: string | null;
  free: boolean;
  priceAmountMinor: number | null;
  currency: string;
  ratingAverage: number;
  ratingCount: number;
};

/**
 * The teacher's published courses, without the internal test ones (same prefixes as the
 * store predicate). A failure counts as null: the profile stays up with the notice
 * that the courses did not load.
 */
export const listCreatorCourses = cache(async (ownerId: string): Promise<CreatorCourse[] | null> => {
  try {
    const { data, error } = await client()
      .from("courses")
      .select("id, title, title_key, cover_image_url, payment_type, price_amount_minor, currency, rating_average, rating_count")
      .eq("owner_id", ownerId)
      .eq("status", "published")
      .not("id", "like", `${INTERNAL_COURSE_ID_PREFIX}%`)
      .not("title", "like", `${INTERNAL_COURSE_TITLE_PREFIX}%`)
      .order("title")
      .limit(48);
    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      // Same rule as courseUrlSlug: title_key, otherwise the id. The legacy `slug`
      // does not work: the course page only resolves id and title_key.
      href: `/courses/${row.title_key || row.id}`,
      title: row.title,
      coverImageUrl: row.cover_image_url,
      free: row.payment_type === "free",
      priceAmountMinor: row.price_amount_minor,
      currency: row.currency ?? "USD",
      ratingAverage: row.rating_average ?? 0,
      ratingCount: row.rating_count ?? 0,
    }));
  } catch (error) {
    console.error("[public-profile] listCreatorCourses failed", error);
    return null;
  }
});
