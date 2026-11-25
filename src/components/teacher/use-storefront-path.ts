"use client";

import { useEffect, useState } from "react";

import { instructorPagePath } from "@/domain/user-profile";
import { getPublicProfile } from "@/lib/data/user-profiles";

/**
  * Public address of the storefront of `uid`, for the studio screens that show
  * or copy the link: `/@username` when the public profile has an @, otherwise
  * `/instructors/{uid}` (which is also the value until the read answers).
 *
  * Reads `public_profiles` once: it is the @ the public page knows. A read
  * failure keeps the link by uid, which keeps working.
 */
export function useStorefrontPath(uid: string): string {
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    let live = true;
    Promise.resolve()
      .then(() => getPublicProfile(uid))
      .then((profile) => {
        if (live) setUsername(profile?.username ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uid]);

  return instructorPagePath(uid, username);
}
