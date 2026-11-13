"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { CommunityFeed } from "@/components/learn/community-feed";
import { MemberAreaShell, type MemberAreaBrand } from "@/components/learn/member-area-shell";
import type { CommunitySpace } from "@/domain/learning";
import { getMemberAreaCommunity, type MemberAreaCommunity } from "@/lib/data/member-areas";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; community: MemberAreaCommunity };

/**
 * A comunidade da área inteira. O feed é o mesmo da sala de aula; quem entra é
 * decidido no banco (has_community_access), então o portão de matrícula do feed
 * fica desligado aqui: o aluno de outro produto do professor não tem matrícula
 * neste, e mesmo assim é membro.
 */
export function MemberAreaCommunityView({
  areaRef,
  brand = null,
  openPostId = null,
}: {
  areaRef: string;
  brand?: MemberAreaBrand | null;
  openPostId?: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const areaPath = `/learn/areas/${encodeURIComponent(areaRef)}`;

  useEffect(() => {
    let cancelled = false;
    getMemberAreaCommunity(areaRef)
      .then((community) => {
        if (cancelled) return;
        // Sem comunidade escolhida, ou quem pede não é membro: volta à área,
        // que por sua vez manda para a vitrine quem não é aluno.
        if (!community) {
          router.replace(areaPath);
          return;
        }
        setState({ status: "ready", community });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [areaPath, areaRef, router]);

  if (state.status !== "ready") {
    return (
      <MemberAreaShell brand={brand}>
        <p role={state.status === "loading" ? "status" : "alert"} className="px-4 text-sm text-[var(--ma-ink-soft)] md:px-0">
          {t(state.status === "loading" ? "learn.memberArea.loading" : "learn.memberArea.loadError")}
        </p>
      </MemberAreaShell>
    );
  }

  const { community } = state;
  const space: CommunitySpace = {
    id: `area-${community.courseId}`,
    courseSlug: community.courseId,
    name: community.title,
    description: t("learn.memberArea.communityDescription"),
    visibility: "enrolled_only",
    categories: ["announcement", "discussion", "question", "resource"],
  };

  return (
    <MemberAreaShell brand={brand}>
      <div className="grid gap-4 px-4 md:px-0">
        <Link href={areaPath} className="text-sm font-semibold text-[var(--ma-accent)] underline-offset-2 hover:underline">
          ← {t("learn.memberArea.communityBack")}
        </Link>
        <h1 className="display-title text-3xl text-[var(--ma-ink)]">{community.title}</h1>
        <section className="member-resource-panel">
          <CommunityFeed space={space} openPostId={openPostId} canModerate={community.isOwner} skipEnrollmentGate />
        </section>
      </div>
    </MemberAreaShell>
  );
}
