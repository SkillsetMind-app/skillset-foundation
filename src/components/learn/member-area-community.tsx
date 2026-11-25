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
 * The community of the whole area. The feed is the same as the classroom's; who gets in is
 * decided in the database (has_community_access), so the feed's enrollment gate
 * is turned off here: a learner from another product by the teacher has no enrollment
 * in this one, and is still a member.
 */
export function MemberAreaCommunityView({
  areaRef,
  slug = null,
  brand = null,
  openPostId = null,
}: {
  areaRef: string;
  /** Extra area; null = the main one. */
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
        // No community chosen, or the requester is not a member: go back to the area,
        // which in turn sends anyone who is not a learner to the storefront.
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

  // "Try again" calls the same read; the notice only goes away when it succeeds, and
  // the button locks while it runs (the function does too: a second click before
  // redrawing does not start another read). Focus goes to the frame (the locked
  // button loses it, and disappears if it works).
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
      // The notice stays, with the button again.
    } finally {
      retryInFlight.current = false;
      setRetrying(false);
    }
  }

  // The community read does not bring the area's theme; the last one seen in the
  // area counts (saved when it opens). Before, the community never received the theme:
  // the same area was dark on the cover and light here. With no saved theme, it waits
  // in the neutral frame and opens in the default light theme.
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
    // In the area theme's tones, like the area cover's error (member-area-home).
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
      {/* The same node as the error frame: after "Try again" focus stays here. */}
      <div ref={frameRef} tabIndex={-1} className="grid gap-4 px-4 md:px-0">
        {/* --ma-accent is the button background (and the color the teacher picks):
            as text it gave 2.9:1 on a dark course. The area's accent text
            is --ma-accent-ink, like the link at the start of the area. */}
        <Link href={areaPath} className="text-sm font-semibold text-[var(--ma-accent-ink)] underline-offset-2 hover:underline">
          ← {t("learn.memberArea.communityBack")}
        </Link>
        <h1 className="display-title text-3xl text-[var(--ma-ink)]">{community.title}</h1>
        {/* The same surface as the classroom's Community tab: inside
            .member-classroom[data-members-theme] the feed and the drawer swap the
            platform's tones for the theme's (globals.css). Outside it the feed
            stayed in the platform's tones, ignoring the area's theme. On the phone
            it runs edge to edge, like the classroom. */}
        <section className="member-classroom member-resource-panel -mx-4 md:mx-0" data-members-theme={theme}>
          <CommunityFeed space={space} openPostId={openPostId} canModerate={community.isOwner} skipEnrollmentGate />
        </section>
      </div>
    </MemberAreaShell>
  );
}
