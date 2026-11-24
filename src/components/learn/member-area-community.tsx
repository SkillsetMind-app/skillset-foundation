"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { CommunityFeed } from "@/components/learn/community-feed";
import { MemberAreaShell, type MemberAreaBrand } from "@/components/learn/member-area-shell";
import { BusyLabel } from "@/components/ui/busy-label";
import type { CommunitySpace } from "@/domain/learning";
import {
  getMemberAreaCommunity,
  memberAreaRoutePath,
  rememberedMemberAreaTheme,
  type MemberAreaCommunity,
} from "@/lib/data/member-areas";

const bone = "animate-pulse rounded-lg bg-[var(--ma-line,var(--color-surface-strong))]";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; community: MemberAreaCommunity };

/**
 * A comunidade da área inteira. O feed é o mesmo da sala de aula; quem entra é
 * decidido no banco (has_community_access), então o portão de matrícula do feed
 * fica desligado aqui: o aluno de outro produto do professor não tem matrícula
 * neste, e mesmo assim é membro.
 */
export function MemberAreaCommunityView({
  areaRef,
  slug = null,
  brand = null,
  openPostId = null,
}: {
  areaRef: string;
  /** Área extra; null = a principal. */
  slug?: string | null;
  brand?: MemberAreaBrand | null;
  openPostId?: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const areaPath = memberAreaRoutePath(areaRef, slug);

  useEffect(() => {
    let cancelled = false;
    getMemberAreaCommunity(areaRef, slug)
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
  }, [areaPath, areaRef, slug, router]);

  // "Try again" chama a mesma leitura; o aviso só sai quando ela dá certo, e
  // o botão trava enquanto ela corre (a função também: um segundo clique antes
  // de redesenhar não abre outra leitura). O foco vai para a moldura (o botão
  // travado o perde, e some se der certo).
  const [retrying, setRetrying] = useState(false);
  const retryInFlight = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);
  async function retryLoad() {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    frameRef.current?.focus();
    setRetrying(true);
    try {
      const community = await getMemberAreaCommunity(areaRef, slug);
      if (!community) {
        router.replace(areaPath);
        return;
      }
      setState({ status: "ready", community });
    } catch {
      // O aviso fica, com o botão de novo.
    } finally {
      retryInFlight.current = false;
      setRetrying(false);
    }
  }

  // A leitura da comunidade não traz o tema da área; vale o último visto na
  // área (gravado quando ela abre). Antes a comunidade nunca recebia o tema:
  // a mesma área era escura na capa e clara aqui. Sem tema guardado, espera
  // na moldura neutra e abre no claro padrão.
  const remembered = rememberedMemberAreaTheme(areaRef, slug);

  if (state.status === "loading") {
    return (
      <MemberAreaShell brand={brand} theme={remembered}>
        <div className="grid gap-4 px-4 md:px-0">
          <p role="status" className="sr-only">{t("learn.memberArea.loading")}</p>
          <div aria-hidden="true" className={`h-5 w-36 ${bone}`} />
          <div aria-hidden="true" className={`h-9 w-2/3 max-w-sm ${bone}`} />
          <div aria-hidden="true" className={`-mx-4 h-96 md:mx-0 ${bone}`} />
        </div>
      </MemberAreaShell>
    );
  }

  const theme = remembered ?? "light";

  if (state.status === "error") {
    // Nos tons do tema da área, como o erro da capa da área (member-area-home).
    return (
      <MemberAreaShell brand={brand} theme={theme}>
        <div ref={frameRef} tabIndex={-1} className="grid justify-items-start gap-3 px-4 md:px-0">
          <p role="alert" className="text-sm text-[var(--ma-ink-soft)]">
            {t("learn.memberArea.loadError")}
          </p>
          <button
            type="button"
            onClick={() => void retryLoad()}
            disabled={retrying}
            aria-busy={retrying || undefined}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-[var(--ma-line)] px-4 text-sm font-semibold text-[var(--ma-ink)] disabled:opacity-60"
          >
            <BusyLabel busy={retrying} idle={t("appErrors.retry")} busyText={t("appErrors.retrying")} />
          </button>
        </div>
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
    <MemberAreaShell brand={brand} theme={theme}>
      {/* O mesmo nó da moldura do erro: depois do "Try again" o foco fica aqui. */}
      <div ref={frameRef} tabIndex={-1} className="grid gap-4 px-4 md:px-0">
        {/* --ma-accent é o fundo dos botões (e a cor que o professor escolhe):
            como texto dava 2,9:1 num curso escuro. Texto de destaque da área
            é --ma-accent-ink, como o link do início da área. */}
        <Link href={areaPath} className="text-sm font-semibold text-[var(--ma-accent-ink)] underline-offset-2 hover:underline">
          ← {t("learn.memberArea.communityBack")}
        </Link>
        <h1 className="display-title text-3xl text-[var(--ma-ink)]">{community.title}</h1>
        {/* A mesma superfície da aba Comunidade da sala: dentro de
            .member-classroom[data-members-theme] o feed e a gaveta trocam os
            tons da plataforma pelos do tema (globals.css). Fora dela o feed
            ficava nos tons da plataforma, alheio ao tema da área. No celular
            vai de borda a borda, como a sala. */}
        <section className="member-classroom member-resource-panel -mx-4 md:mx-0" data-members-theme={theme}>
          <CommunityFeed space={space} openPostId={openPostId} canModerate={community.isOwner} skipEnrollmentGate />
        </section>
      </div>
    </MemberAreaShell>
  );
}
