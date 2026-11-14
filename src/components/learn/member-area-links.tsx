"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";
import { publicProfileName, type PublicProfile } from "@/domain/user-profile";
import { getMemberAreaSlugs, memberAreaPath } from "@/lib/data/member-areas";
import { getPublicProfilesByIds, subscribeToPublicProfile } from "@/lib/data/user-profiles";

const studentStatuses = new Set(["active", "completed"]);

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
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  // null = ainda perguntando: sem atalho, para não mandar o aluno de uma extra à principal.
  const [slugs, setSlugs] = useState<{ key: string; map: Awaited<ReturnType<typeof getMemberAreaSlugs>> } | null>(null);

  useEffect(() => {
    if (!ownedKey) return;
    let cancelled = false;
    const pairs = ownedKey.split(",").map((pair) => pair.split(":"));
    getPublicProfilesByIds(Array.from(new Set(pairs.map(([, ownerId]) => ownerId))))
      .then((next) => {
        if (!cancelled) setProfiles(next);
      })
      // Atalho é conveniência: sem o perfil, o painel segue sem ele.
      .catch(() => undefined);
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
  const links = new Map<string, { href: string; name: string }>();
  const resolved = slugs?.key === ownedKey ? slugs.map : null;
  for (const pair of ownedKey && resolved ? ownedKey.split(",") : []) {
    const [courseId, ownerId] = pair.split(":");
    const profile = profiles.find((candidate) => candidate.uid === ownerId);
    const creatorName = profile ? publicProfileName(profile) : null;
    if (!profile || !creatorName) continue;
    const extra = resolved?.get(courseId) ?? null;
    links.set(`${ownerId}/${extra?.slug ?? ""}`, {
      href: memberAreaPath({ username: profile.username, ownerId, slug: extra?.slug }),
      name: extra ? extra.name?.trim() || creatorName : creatorName,
    });
  }
  return (
    <>
      {[...links].map(([key, link]) => (
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
