"use client";

import { useEffect, useState } from "react";

import { getPublicProfilesByIds } from "@/lib/data/user-profiles";

export type InstructorName = { name: string; photoURL: string | null };

/**
 * Nome e foto do professor de cada cartao da lista, em UMA consulta.
 *
 * O cartao mostra quem ensina — comprar um curso e escolher uma pessoa, e a
 * lista escondia esse dado. Resolver perfil dentro do cartao daria uma consulta
 * por cartao; aqui a lista inteira vira um `in (...)` so.
 *
 * Professor sem perfil publico simplesmente nao aparece no cartao: identidade
 * de instrutor nao se inventa.
 */
export function useInstructorNames(
  ownerIds: (string | undefined)[],
): Map<string, InstructorName> {
  const [names, setNames] = useState<Map<string, InstructorName>>(
    () => new Map(),
  );
  // Chave estavel: o efeito so roda de novo quando o CONJUNTO de donos muda,
  // e nao a cada render da lista (que remonta o array toda vez).
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
                },
              ]),
          ),
        );
      })
      // Falha silenciosa: a lista de cursos continua util sem a linha do
      // professor. Um erro vermelho no catalogo por causa de um avatar, nao.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [key]);

  return names;
}
