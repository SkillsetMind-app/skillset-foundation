"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";
import { publicProfileName, type PublicProfile } from "@/domain/user-profile";
import { getMemberAreaSlugs, memberAreaPath } from "@/lib/data/member-areas";
import { getPublicProfilesByIds, subscribeToPublicProfile } from "@/lib/data/user-profiles";

const studentStatuses = new Set(["active", "completed"]);

type AreaLink = { href: string; name: string };

// The shortcuts depend on three reads in a queue (courses, then profiles and areas)
// and arrived ~0.4 s after the /learn header: on the phone the button opened
// a second line and "My courses" dropped 54px. The last shortcuts built
// for the SAME enrollments stay on this device and hold the place from the
// header on (the enrollments arrive along with it). We only write when both
// reads succeeded: a failure sends everything to the main area and must not become
// the memory of a learner of an extra area.
const LINKS_CACHE_KEY = "skillset:learn-member-area-links.v1";
const EMPTY_SUBSCRIBE = () => () => {};

function readLinksCache(): string | null {
  try {
    return window.localStorage.getItem(LINKS_CACHE_KEY);
  } catch {
    return null;
  }
}

function cachedLinksFor(raw: string | null, purchasedKey: string): [string, AreaLink][] | null {
  if (!raw || !purchasedKey) return null;
  try {
    const saved = JSON.parse(raw);
    if (saved?.key !== purchasedKey || !Array.isArray(saved.links)) return null;
    // Only addresses inside the members area itself: storage is not a trustworthy source of links.
    return saved.links.filter(
      (entry: unknown): entry is [string, AreaLink] =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1]?.name === "string" &&
        typeof entry[1]?.href === "string" &&
        entry[1].href.startsWith("/learn/areas/"),
    );
  } catch {
    return null;
  }
}

/**
 * /learn: a "{name}'s area" shortcut per area the person is a learner of: the
 * main one of each creator and, if they bought a product from an extra area, that
 * extra one (with its name).
 */
export function MemberAreaLinks({
  courses,
  enrollments,
  coursesSettled = true,
}: {
  courses: readonly TeacherCourse[];
  enrollments: readonly Enrollment[];
  // The courses read finished (well or badly). Before that the stored place
  // holds; after, with no matching course at all, there is no shortcut to wait for.
  coursesSettled?: boolean;
}) {
  const { t } = useTranslation();
  // The purchased products, from the enrollments only: it already exists when the header
  // appears, before the course list.
  const purchasedKey = useMemo(
    () =>
      Array.from(
        new Set(
          enrollments
            .filter((enrollment) => studentStatuses.has(enrollment.status))
            .map((enrollment) => enrollment.courseId),
        ),
      )
        .sort()
        .join(","),
    [enrollments],
  );
  // "courseId:ownerId" of each purchased product, in a stable order.
  const ownedKey = useMemo(() => {
    const owned = new Set(purchasedKey ? purchasedKey.split(",") : []);
    return courses
      .filter((course) => owned.has(course.id) && course.ownerId)
      .map((course) => `${course.id}:${course.ownerId}`)
      .sort()
      .join(",");
  }, [courses, purchasedKey]);
  const [profiles, setProfiles] = useState<{ key: string; ok: boolean; list: PublicProfile[] } | null>(null);
  // null = still asking: no shortcut, so the learner of an extra area is not sent to the main one.
  const [slugs, setSlugs] = useState<{
    key: string;
    ok: boolean;
    map: Awaited<ReturnType<typeof getMemberAreaSlugs>>;
  } | null>(null);

  useEffect(() => {
    if (!ownedKey) return;
    let cancelled = false;
    const pairs = ownedKey.split(",").map((pair) => pair.split(":"));
    getPublicProfilesByIds(Array.from(new Set(pairs.map(([, ownerId]) => ownerId))))
      .then((next) => {
        if (!cancelled) setProfiles({ key: ownedKey, ok: true, list: next });
      })
      // A shortcut is a convenience: without the profile, the dashboard goes on without it.
      .catch(() => {
        if (!cancelled) setProfiles({ key: ownedKey, ok: false, list: [] });
      });
    getMemberAreaSlugs(pairs.map(([courseId]) => courseId))
      .then((map) => {
        if (!cancelled) setSlugs({ key: ownedKey, ok: true, map });
      })
      // Without the answer, every shortcut leads to the main area, as before the extras.
      .catch(() => {
        if (!cancelled) setSlugs({ key: ownedKey, ok: false, map: new Map() });
      });
    return () => {
      cancelled = true;
    };
  }, [ownedKey]);

  // One entry per (creator, area), in the order of the products.
  const links = new Map<string, AreaLink>();
  const resolved = slugs?.key === ownedKey ? slugs.map : null;
  const profileList = profiles?.key === ownedKey ? profiles.list : [];
  for (const pair of ownedKey && resolved ? ownedKey.split(",") : []) {
    const [courseId, ownerId] = pair.split(":");
    const profile = profileList.find((candidate) => candidate.uid === ownerId);
    const creatorName = profile ? publicProfileName(profile) : null;
    if (!profile || !creatorName) continue;
    const extra = resolved?.get(courseId) ?? null;
    links.set(`${ownerId}/${extra?.slug ?? ""}`, {
      href: memberAreaPath({ username: profile.username, ownerId, slug: extra?.slug }),
      name: extra ? extra.name?.trim() || creatorName : creatorName,
    });
  }
  // Both reads of this list arrived: the current shortcuts count.
  const settled = coursesSettled && (!ownedKey || (resolved !== null && profiles?.key === ownedKey));
  // And only the two good ones become memory (including "no shortcut").
  const freshJson =
    settled && ownedKey && slugs?.ok && profiles?.ok && ownedKey.split(",").length === purchasedKey.split(",").length
      ? JSON.stringify([...links])
      : null;
  useEffect(() => {
    if (freshJson === null) return;
    try {
      window.localStorage.setItem(LINKS_CACHE_KEY, `{"key":${JSON.stringify(purchasedKey)},"links":${freshJson}}`);
    } catch {
      // ponytail: storage blocked: the shortcuts just wait for the reads, as before.
    }
  }, [purchasedKey, freshJson]);
  const cachedRaw = useSyncExternalStore(EMPTY_SUBSCRIBE, readLinksCache, () => null);
  const cached = useMemo(() => cachedLinksFor(cachedRaw, purchasedKey), [cachedRaw, purchasedKey]);
  const label = (link: AreaLink) => t("learn.memberArea.openArea").replace("{name}", () => link.name);

  if (!settled) {
    // The stored place does not navigate: the product may have changed area since the
    // last visit, and the old address would lead to the wrong area. The real
    // button takes the same place, at the same size, when the reads arrive.
    return (
      <>
        {(cached ?? []).map(([key, link]) => (
          <span key={key} aria-hidden="true" data-reserved="member-area-link" className="button-outline pointer-events-none px-4 text-sm">
            {label(link)}
          </span>
        ))}
      </>
    );
  }

  return (
    <>
      {[...links].map(([key, link]) => (
        <Link key={key} href={link.href} className="button-outline px-4 text-sm">
          {label(link)}
        </Link>
      ))}
    </>
  );
}

/**
 * The creator's area for the room's "back": { href, name } when they have a
 * public profile, otherwise null (the room goes back to /learn). Through the same public
 * read the room already does to name the teacher. A product in an extra area
 * goes back to it.
 */
export function useCreatorAreaLink(
  ownerId: string | null | undefined,
  courseId: string | null = null,
): { href: string; name: string } | null {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  // The product's area: slug null = the main one.
  const [area, setArea] = useState<{ courseId: string; slug: string | null; name: string | null } | null>(null);

  useEffect(() => {
    if (!ownerId) return;
    return subscribeToPublicProfile(ownerId, setProfile, () => setProfile(null));
  }, [ownerId]);

  useEffect(() => {
    if (!ownerId || !courseId) return;
    let cancelled = false;
    getMemberAreaSlugs([courseId])
      .then((slugs) => {
        const found = slugs.get(courseId);
        if (!cancelled) setArea({ courseId, slug: found?.slug ?? null, name: found?.name ?? null });
      })
      // Without the answer, it goes back to the main one.
      .catch(() => {
        if (!cancelled) setArea({ courseId, slug: null, name: null });
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, courseId]);

  const creatorName = profile && profile.uid === ownerId ? publicProfileName(profile) : null;
  if (!profile || !creatorName) return null;
  // While asking, the main one: the "back" shows up already on the first paint.
  const extra = courseId && area?.courseId === courseId && area.slug ? area : null;
  return {
    href: memberAreaPath({ username: profile.username, ownerId: profile.uid, slug: extra?.slug }),
    name: extra ? extra.name?.trim() || creatorName : creatorName,
  };
}
