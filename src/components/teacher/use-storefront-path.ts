"use client";

import { useEffect, useState } from "react";

import { instructorPagePath } from "@/domain/user-profile";
import { getPublicProfile } from "@/lib/data/user-profiles";

/**
 * Endereço público da vitrine de `uid`, para as telas do estúdio que mostram
 * ou copiam o link: `/@usuario` quando o perfil público tem @, senão
 * `/instructors/{uid}` (que também é o valor até a leitura responder).
 *
 * Lê `public_profiles` uma vez: é o @ que a página pública conhece. Falha de
 * leitura mantém o link pelo uid, que continua funcionando.
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
