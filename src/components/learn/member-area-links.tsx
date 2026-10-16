"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import type { Enrollment } from "@/domain/enrollment";
import type { TeacherCourse } from "@/domain/teacher-course";
import { publicProfileName, type PublicProfile } from "@/domain/user-profile";
import { memberAreaPath } from "@/lib/data/member-areas";
import { getPublicProfilesByIds, subscribeToPublicProfile } from "@/lib/data/user-profiles";

const studentStatuses = new Set(["active", "completed"]);

/** /learn: um atalho "Área de {nome}" por criador de quem a pessoa é aluna. */
export function MemberAreaLinks({
  courses,
  enrollments,
}: {
  courses: readonly TeacherCourse[];
  enrollments: readonly Enrollment[];
}) {
  const { t } = useTranslation();
  const ownerKey = useMemo(() => {
    const owned = new Set(
      enrollments.filter((enrollment) => studentStatuses.has(enrollment.status)).map((enrollment) => enrollment.courseId),
    );
    return Array.from(new Set(courses.filter((course) => owned.has(course.id) && course.ownerId).map((course) => course.ownerId)))
      .sort()
      .join(",");
  }, [courses, enrollments]);
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);

  useEffect(() => {
    if (!ownerKey) return;
    let cancelled = false;
    getPublicProfilesByIds(ownerKey.split(","))
      .then((next) => {
        if (!cancelled) setProfiles(next);
      })
      // Atalho é conveniência: sem o perfil, o painel segue sem ele.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ownerKey]);

  const owners = new Set(ownerKey.split(","));
  return (
    <>
      {profiles
        .filter((profile) => owners.has(profile.uid) && publicProfileName(profile))
        .map((profile) => (
          <Link
            key={profile.uid}
            href={memberAreaPath({ username: profile.username, ownerId: profile.uid })}
            className="button-outline px-4 text-sm"
          >
            {t("learn.memberArea.openArea").replace("{name}", () => publicProfileName(profile) ?? "")}
          </Link>
        ))}
    </>
  );
}

/**
 * A área do criador para o "voltar" da sala: { href, nome } quando ele tem
 * perfil público, senão null (a sala volta para /learn). Pela mesma leitura
 * pública que a sala já faz para nomear o professor.
 */
export function useCreatorAreaLink(ownerId: string | null | undefined): { href: string; name: string } | null {
  const [profile, setProfile] = useState<PublicProfile | null>(null);

  useEffect(() => {
    if (!ownerId) return;
    return subscribeToPublicProfile(ownerId, setProfile, () => setProfile(null));
  }, [ownerId]);

  const name = profile && profile.uid === ownerId ? publicProfileName(profile) : null;
  if (!profile || !name) return null;
  return { href: memberAreaPath({ username: profile.username, ownerId: profile.uid }), name };
}
