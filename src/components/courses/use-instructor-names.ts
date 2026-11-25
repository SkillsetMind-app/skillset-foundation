"use client";

import { useEffect, useState } from "react";

import { getPublicProfilesByIds } from "@/lib/data/user-profiles";

export type InstructorName = { name: string; photoURL: string | null; verified: boolean };

/**
 * Name and photo of the teacher on each card in the list, in ONE query.
 *
 * The card shows who teaches — buying a course means choosing a person, and the
 * list used to hide that data. Resolving the profile inside the card would make one query
 * per card; here the whole list becomes a single `in (...)`.
 *
 * A teacher with no public profile simply does not appear on the card: an
 * instructor's identity is not made up.
 */
export function useInstructorNames(
  ownerIds: (string | undefined)[],
): Map<string, InstructorName> {
  const [names, setNames] = useState<Map<string, InstructorName>>(
    () => new Map(),
  );
  // Stable key: the effect only runs again when the SET of owners changes,
  // and not on every render of the list (which rebuilds the array every time).
  const key = Array.from(new Set(ownerIds.filter(Boolean) as string[]))
    .sort()
    .join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    getPublicProfilesByIds(key.split(","))
      .then((profiles) => {
        if (cancelled) return;
        setNames(
          new Map(
            profiles
              .filter((profile) => profile.displayName)
              .map((profile) => [
                profile.uid,
                {
                  name: profile.displayName as string,
                  photoURL: profile.photoURL ?? null,
                  verified: Boolean(profile.verification),
                },
              ]),
          ),
        );
      })
      // Silent failure: the course list stays useful without the teacher's line.
      // A red error in the catalog over an avatar is not.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [key]);

  return names;
}
