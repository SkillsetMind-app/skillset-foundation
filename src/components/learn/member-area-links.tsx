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

// Os atalhos dependem de duas leituras (perfis e areas) e chegavam ~0,4 s
// depois do resto do /learn: no celular o botao abria uma segunda linha e
// "My courses" descia 54px. Os ultimos atalhos montados para a MESMA lista de
// compras ficam neste aparelho e aparecem ja no primeiro desenho; quando as
// leituras chegam, valem elas.
const LINKS_CACHE_KEY = "skillset:learn-member-area-links.v1";
const EMPTY_SUBSCRIBE = () => () => {};

function readLinksCache(): string | null {
  try {
    return window.localStorage.getItem(LINKS_CACHE_KEY);
  } catch {
    return null;
  }
}

function cachedLinksFor(raw: string | null, ownedKey: string): [string, AreaLink][] | null {
  if (!raw || !ownedKey) return null;
  try {
    const saved = JSON.parse(raw);
    if (saved?.key !== ownedKey || !Array.isArray(saved.links)) return null;
    // So enderecos da propria area de membros: o armazenamento nao e fonte confiavel de link.
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
 * /learn: um atalho "Área de {nome}" por área de quem a pessoa é aluna: a
 * principal de cada criador e, se ela comprou produto de uma área extra, essa
 * extra (com o nome dela).
 */
export function MemberAreaLinks({
  courses,
  enrollments,
}: {
  courses: readonly TeacherCourse[];
  enrollments: readonly Enrollment[];
}) {
  const { t } = useTranslation();
  // "courseId:ownerId" de cada produto comprado, em ordem estável.
  const ownedKey = useMemo(() => {
    const owned = new Set(
      enrollments.filter((enrollment) => studentStatuses.has(enrollment.status)).map((enrollment) => enrollment.courseId),
    );
    return courses
      .filter((course) => owned.has(course.id) && course.ownerId)
      .map((course) => `${course.id}:${course.ownerId}`)
      .sort()
      .join(",");
  }, [courses, enrollments]);
  const [profiles, setProfiles] = useState<{ key: string; list: PublicProfile[] } | null>(null);
  // null = ainda perguntando: sem atalho, para não mandar o aluno de uma extra à principal.
  const [slugs, setSlugs] = useState<{ key: string; map: Awaited<ReturnType<typeof getMemberAreaSlugs>> } | null>(null);

  useEffect(() => {
    if (!ownedKey) return;
    let cancelled = false;
    const pairs = ownedKey.split(",").map((pair) => pair.split(":"));
    getPublicProfilesByIds(Array.from(new Set(pairs.map(([, ownerId]) => ownerId))))
      .then((next) => {
        if (!cancelled) setProfiles({ key: ownedKey, list: next });
      })
      // Atalho é conveniência: sem o perfil, o painel segue sem ele.
      .catch(() => {
        if (!cancelled) setProfiles({ key: ownedKey, list: [] });
      });
    getMemberAreaSlugs(pairs.map(([courseId]) => courseId))
      .then((map) => {
        if (!cancelled) setSlugs({ key: ownedKey, map });
      })
      // Sem a resposta, todo atalho leva à principal, como antes das extras.
      .catch(() => {
        if (!cancelled) setSlugs({ key: ownedKey, map: new Map() });
      });
    return () => {
      cancelled = true;
    };
  }, [ownedKey]);

  // Uma entrada por (criador, área), na ordem dos produtos.
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
  // As duas leituras desta lista chegaram: os atalhos de agora valem e ficam
  // guardados para a proxima visita (inclusive "nenhum").
  const settled = Boolean(ownedKey) && resolved !== null && profiles?.key === ownedKey;
  const freshJson = settled ? JSON.stringify([...links]) : null;
  useEffect(() => {
    if (freshJson === null) return;
    try {
      window.localStorage.setItem(LINKS_CACHE_KEY, `{"key":${JSON.stringify(ownedKey)},"links":${freshJson}}`);
    } catch {
      // ponytail: armazenamento bloqueado: os atalhos so esperam as leituras, como antes.
    }
  }, [ownedKey, freshJson]);
  const cachedRaw = useSyncExternalStore(EMPTY_SUBSCRIBE, readLinksCache, () => null);
  const cached = useMemo(() => cachedLinksFor(cachedRaw, ownedKey), [cachedRaw, ownedKey]);
  const shown = settled ? [...links] : (cached ?? []);

  return (
    <>
      {shown.map(([key, link]) => (
        <Link key={key} href={link.href} className="button-outline px-4 text-sm">
          {t("learn.memberArea.openArea").replace("{name}", () => link.name)}
        </Link>
      ))}
    </>
  );
}

/**
 * A área do criador para o "voltar" da sala: { href, nome } quando ele tem
 * perfil público, senão null (a sala volta para /learn). Pela mesma leitura
 * pública que a sala já faz para nomear o professor. Produto numa área extra
 * volta para ela.
 */
export function useCreatorAreaLink(
  ownerId: string | null | undefined,
  courseId: string | null = null,
): { href: string; name: string } | null {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  // A área do produto: slug null = principal.
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
      // Sem a resposta, volta para a principal.
      .catch(() => {
        if (!cancelled) setArea({ courseId, slug: null, name: null });
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, courseId]);

  const creatorName = profile && profile.uid === ownerId ? publicProfileName(profile) : null;
  if (!profile || !creatorName) return null;
  // Enquanto pergunta, a principal: o "voltar" aparece já no primeiro desenho.
  const extra = courseId && area?.courseId === courseId && area.slug ? area : null;
  return {
    href: memberAreaPath({ username: profile.username, ownerId: profile.uid, slug: extra?.slug }),
    name: extra ? extra.name?.trim() || creatorName : creatorName,
  };
}
